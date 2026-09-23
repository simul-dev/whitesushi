import {
  canonicalJson, DomainValidationError, validateDemand, validateOperation, validateSimulation,
  validateSimulationSnapshot, type Assumption, type OperationModel, type OperationProcess,
  type SimulationEngine, type SimulationResult, type SimulationSnapshot,
} from "../../core";
import { validateOperationProcess } from "./process";
import { MinHeap, randomStream } from "./random";

type Stage = OperationProcess["stages"][number];
type Requirement = Stage["requirements"][number];
type Resource = OperationProcess["resources"][number] & {
  busy: number; busySeconds: number; blockedCustomerSeconds: number; occupied: Set<number>;
};
type Allocation = { resourceId: string; units: number; members: number[]; release: Requirement["release"] };
type CustomerParty = {
  id: number; size: number; arrivedAt: number; waitSeconds: number; stageId: string;
  state: "waiting" | "active" | "served" | "lost"; requestedAt: number; requestId: number; held: Allocation[];
};
type Event = { time: number; sequence: number; kind: "arrival" | "completion" | "timeout"; party: CustomerParty; requestId: number };
const PRIORITY = { completion: 0, timeout: 1, arrival: 2 };
const fail = (path: string, message: string): never => { throw new DomainValidationError(path, message); };
const ratio = (numerator: number, denominator: number) => denominator > 0 ? numerator / denominator : 0;
// Resource conservation is checked separately; bound floating-point summation roundoff.
const utilizationRatio = (busy: number, capacity: number) => Math.min(1, Math.max(0, ratio(busy, capacity)));
const MAX_PARTIES = 100000;

/** Seconds-based, empty-start, fixed-horizon DES; each invocation owns all mutable state. */
export class DiscreteEventSimulationEngine implements SimulationEngine {
  readonly descriptor = Object.freeze({ id: "generic-des", version: "1.0.0" });

  async run({ runId, snapshot, operationModel }: { runId: string; snapshot: SimulationSnapshot; operationModel: OperationModel }): Promise<SimulationResult> {
    if (!runId.trim()) fail("runId", "required");
    validateSimulationSnapshot(snapshot);
    if (canonicalJson(snapshot.engine) !== canonicalJson(this.descriptor)) fail("snapshot.engine", "engine version mismatch");
    const { layout, demand, operation, config } = snapshot.input;
    validateDemand(demand); validateOperation(operation); validateSimulation(config);
    if (config.replications !== 1) fail("config.replications", "one run returns one replication; prepare separate runs with explicit seeds");
    if (canonicalJson(operationModel.descriptor) !== canonicalJson(operation.model)) fail("operation.model", "injected model version mismatch");
    const modelInput = structuredClone({ layout, policy: operation });
    const issues = operationModel.validate(modelInput);
    if (issues.length) fail(issues[0].path, issues.map((issue) => issue.message).join("; "));
    const process = structuredClone(operationModel.defineProcess(structuredClone({ layout, policy: operation })));
    if (canonicalJson(process.model) !== canonicalJson(operationModel.descriptor)) fail("process.model", "process version mismatch");
    validateOperationProcess(process);
    const start = config.startMinute * 60, horizon = config.durationSeconds;
    const firstHour = Math.floor(start / 3600), lastHour = Math.ceil((start + horizon) / 3600);
    const demandByHour = new Map(demand.buckets.filter((bucket) => bucket.dayType === config.dayType).map((bucket) => [bucket.hour, bucket]));
    for (let hour = firstHour; hour < lastHour; hour++) if (!demandByHour.has(hour)) fail("demand.buckets", `missing explicit demand for hour ${hour}`);
    const windows = operation.operatingWindows.filter((window) => window.dayType === config.dayType);
    if (!windows.length) fail("operation.operatingWindows", "missing operating hours for selected day");
    const sizes = process.partySizeDistribution ?? [{ size: 1, probability: 1 }];
    const probabilityMass = sizes.reduce((sum, item) => sum + item.probability, 0);
    const meanPartySize = sizes.reduce((sum, item) => sum + item.size * item.probability, 0) / probabilityMass;
    const stages = new Map(process.stages.map((stage) => [stage.id, stage]));
    const resources = new Map<string, Resource>(process.resources.map((resource) => [resource.id, { ...resource, busy: 0, busySeconds: 0, blockedCustomerSeconds: 0, occupied: new Set<number>() }]));
    const calendar = new MinHeap<Event>((a, b) => a.time - b.time || PRIORITY[a.kind] - PRIORITY[b.kind] || a.sequence - b.sequence);
    let sequence = 0, partyId = 0, requestId = 0, now = 0;
    let pending: CustomerParty[] = [];
    const arrived: CustomerParty[] = [];
    const servedByHour = new Map<number, number>();
    for (let hour = firstHour; hour < lastHour; hour++) servedByHour.set(hour, 0);
    const schedule = (kind: Event["kind"], time: number, party: CustomerParty) => {
      if (!Number.isFinite(time)) fail("event.time", "duration overflow");
      calendar.push({ kind, time, sequence: sequence++, party, requestId: party.requestId });
    };

    // Demand is customers/hour. Party arrivals have rate customer rate / E[party size].
    // Poisson hours use independent streams; deterministic intensity carries across hours.
    // Thin candidate arrivals by observation/open windows without creating closing-time losses.
    let candidateCount = 0, deterministicIntensity = 0, nextDeterministicArrival = 0.5;
    for (let hour = firstHour; hour < lastHour; hour++) {
      const bucket = demandByHour.get(hour)!;
      if (bucket.expectedCustomersPerHour === 0) continue;
      const partyRate = bucket.expectedCustomersPerHour / meanPartySize;
      if (partyRate > MAX_PARTIES) fail("demand", `per-hour party rate exceeds the ${MAX_PARTIES} party execution guard`);
      const interval = 3600 / partyRate;
      const arrivalsRandom = randomStream(config.seed, `arrivals:${hour}`);
      const sizeRandom = randomStream(config.seed, `party-size:${hour}`);
      const spacing = () => bucket.distribution === "poisson" ? -Math.log(arrivalsRandom()) * interval : interval;
      let offset = bucket.distribution === "poisson" ? spacing() : (nextDeterministicArrival - deterministicIntensity) * interval;
      for (; offset < 3600; offset += spacing()) {
        if (bucket.distribution === "deterministic") nextDeterministicArrival++;
        if (++candidateCount > MAX_PARTIES) fail("demand", `candidate arrivals exceed the ${MAX_PARTIES} party execution guard; shorten the run`);
        const absolute = hour * 3600 + offset;
        const draw = sizeRandom() * probabilityMass;
        let accumulated = 0;
        const size = sizes.find((item) => { accumulated += item.probability; return draw < accumulated; })?.size ?? sizes.find((item) => item.probability > 0)!.size;
        if (absolute < start || absolute >= start + horizon || !windows.some((window) => absolute >= window.startMinute * 60 && absolute < window.endMinute * 60)) continue;
        const party: CustomerParty = { id: partyId++, size, arrivedAt: absolute - start, waitSeconds: 0, stageId: process.startStageId, state: "waiting", requestedAt: absolute - start, requestId: -1, held: [] };
        schedule("arrival", party.arrivedAt, party);
      }
      if (bucket.distribution === "deterministic") deterministicIntensity += partyRate;
    }

    function select(party: CustomerParty, requirement: Requirement): Allocation | null {
      const resource = resources.get(requirement.resourceId)!;
      const units = requirement.units * (requirement.unitsPerCustomer ? party.size : 1);
      if (!Number.isSafeInteger(units)) fail("requirement.units", "customer-scaled units overflow");
      if (resource.capacityUnits - resource.busy < units) return null;
      let members: number[] = [];
      if (resource.unitCapacities) {
        const minimum = requirement.minimumUnitCapacity === "party-size" ? party.size : 0;
        members = resource.unitCapacities.map((capacity, index) => ({ capacity, index }))
          .filter((item) => item.capacity >= minimum && !resource.occupied.has(item.index))
          .sort((a, b) => a.capacity - b.capacity || a.index - b.index).slice(0, units).map((item) => item.index);
        if (members.length !== units) return null;
      }
      return { resourceId: requirement.resourceId, units, members, release: requirement.release };
    }
    function advance(time: number) {
      const elapsed = time - now;
      for (const resource of resources.values()) resource.busySeconds += elapsed * resource.busy;
      for (const party of pending) {
        for (const requirement of stages.get(party.stageId)!.requirements) {
          if (!select(party, requirement)) resources.get(requirement.resourceId)!.blockedCustomerSeconds += elapsed * party.size;
        }
      }
      now = time;
    }
    function release(party: CustomerParty, all: boolean) {
      party.held = party.held.filter((allocation) => {
        if (!all && allocation.release !== "stage-end") return true;
        const resource = resources.get(allocation.resourceId)!;
        resource.busy -= allocation.units;
        allocation.members.forEach((member) => resource.occupied.delete(member));
        if (resource.busy < 0) fail("resources", "resource conservation violated");
        return false;
      });
    }
    function request(party: CustomerParty, stageId: string) {
      party.stageId = stageId; party.state = "waiting"; party.requestedAt = now; party.requestId = requestId++;
      pending.push(party);
      const stage = stages.get(stageId)!;
      if (stage.queue) schedule("timeout", now + stage.queue.maxWaitSeconds, party);
    }
    function dispatch() {
      const blocked = new Set<string>();
      const remaining: CustomerParty[] = [];
      // Earlier requests retain priority for shared resources; independent pools can progress.
      for (const party of pending) {
        const stage = stages.get(party.stageId)!;
        const allocations = stage.requirements.map((requirement) => select(party, requirement));
        if (stage.requirements.some((requirement) => blocked.has(requirement.resourceId)) || allocations.some((allocation) => allocation === null)) {
          stage.requirements.forEach((requirement) => blocked.add(requirement.resourceId));
          remaining.push(party); continue;
        }
        for (const allocation of allocations as Allocation[]) {
          const resource = resources.get(allocation.resourceId)!;
          resource.busy += allocation.units;
          if (resource.busy > resource.capacityUnits) fail("resources", "resource capacity exceeded");
          allocation.members.forEach((member) => resource.occupied.add(member));
          party.held.push(allocation);
        }
        party.waitSeconds += now - party.requestedAt;
        party.state = "active";
        const duration = stage.duration.kind === "constant" ? stage.duration.seconds :
          -Math.log(randomStream(config.seed, `service:${party.id}:${stage.id}`)()) * stage.duration.meanSeconds;
        schedule("completion", now + duration, party);
      }
      pending = remaining;
    }
    let event: Event | undefined;
    let completedSystemSeconds = 0;
    while ((event = calendar.pop())) {
      if (event.time > horizon) break;
      const { party } = event;
      if (event.kind === "timeout" && (party.state !== "waiting" || event.requestId !== party.requestId)) continue;
      advance(event.time);
      if (event.kind === "arrival") {
        arrived.push(party); request(party, process.startStageId);
      } else if (event.kind === "timeout") {
        pending = pending.filter((waiting) => waiting !== party);
        party.waitSeconds += now - party.requestedAt;
        request(party, stages.get(party.stageId)!.queue!.timeoutStageId);
      } else {
        const stage = stages.get(party.stageId)!;
        release(party, stage.outcome !== null);
        if (stage.outcome) {
          party.state = stage.outcome;
          if (stage.outcome === "served") {
            completedSystemSeconds += party.size * (now - party.arrivedAt);
            // Completions exactly at the horizon belong to the last observed hour.
            const hour = Math.min(lastHour - 1, Math.floor((start + now) / 3600));
            servedByHour.set(hour, (servedByHour.get(hour) ?? 0) + party.size);
          }
        } else request(party, stage.nextStageId!);
      }
      dispatch();
    }
    advance(horizon);
    pending.forEach((party) => { party.waitSeconds += horizon - party.requestedAt; });
    const customersArrived = arrived.reduce((sum, party) => sum + party.size, 0);
    const customersServed = arrived.filter((party) => party.state === "served").reduce((sum, party) => sum + party.size, 0);
    const customersLost = arrived.filter((party) => party.state === "lost").reduce((sum, party) => sum + party.size, 0);
    if (!Number.isSafeInteger(customersArrived)) fail("customersArrived", "customer count exceeds safe integer range");
    const resourceUtilization = [...resources.values()].map((resource) => ({ resourceId: resource.id, capacityUnits: resource.capacityUnits, utilization: utilizationRatio(resource.busySeconds, resource.capacityUnits * horizon) }));
    const utilization = (category: string) => {
      const selected = [...resources.values()].filter((resource) => resource.category === category);
      return utilizationRatio(selected.reduce((sum, resource) => sum + resource.busySeconds, 0), selected.reduce((sum, resource) => sum + resource.capacityUnits * horizon, 0));
    };
    const assumptions: Assumption[] = [
      { id: "des-time", description: "Empty system at start; admit only during operating windows; stop at fixed observation horizon without draining", value: horizon, unit: "seconds", source: "generic-des/1.0.0" },
      { id: "des-parties", description: "Demand customers/hour divided by mean party size gives party arrival rate; whole parties follow declared resource and exclusive-unit fit requirements", value: sizes.map((item) => ({ ...item })), unit: "party-size probabilities", source: "operation-process" },
      { id: "des-waiting", description: "Average total queue seconds per arrived customer includes accrued unfinished waits; maximum is one party's cumulative queue seconds", value: "all arrivals, customer weighted", unit: "seconds/customer", source: "generic-des/1.0.0" },
      { id: "des-system-time", description: "Time in system includes all declared stages through terminal completion; denominator is served customers only, excludes unfinished and lost", value: "served customers", unit: "seconds/customer", source: "generic-des/1.0.0" },
      { id: "des-utilization", description: "Busy unit-seconds / (capacity units × full observation seconds); zero-capacity pools report zero and can be bottlenecks", value: "full observation horizon", unit: "ratio", source: "generic-des/1.0.0" },
      { id: "des-seed", description: "Deterministic keyed PRNG streams; one independent seeded replication per run", value: config.seed, unit: "uint32", source: "generic-des/1.0.0" },
      { id: "des-admission-timeout", description: "Initial stage queue timeout; later queues follow injected process", value: stages.get(process.startStageId)!.queue?.maxWaitSeconds ?? null, unit: "seconds", source: "operation-process" },
      { id: "des-finance", description: "Revenue fields are compatibility placeholders; no financial model executed", value: "not-modeled", unit: "status", source: "generic-des/1.0.0" },
      { id: "des-delivery", description: "Arrival stream represents dine-in customers; excluded delivery demand adds no kitchen workload in this version", value: "dine-in only", unit: "scope", source: "demand contract" },
    ];
    const maxWaitingSeconds = arrived.reduce((max, party) => Math.max(max, party.waitSeconds), 0);
    return {
      runId, customersArrived, customersServed, customersLost,
      customersUnfinished: customersArrived - customersServed - customersLost,
      averageWaitingSeconds: Math.min(maxWaitingSeconds, ratio(arrived.reduce((sum, party) => sum + party.waitSeconds * party.size, 0), customersArrived)),
      maxWaitingSeconds,
      throughputCustomersPerHour: customersServed * 3600 / horizon,
      tableUtilization: utilization("table"), kitchenUtilization: utilization("kitchen"), staffUtilization: utilization("staff"),
      resourceUtilization,
      averageCustomerTimeInSystemSeconds: ratio(completedSystemSeconds, customersServed),
      hourlyThroughput: [...servedByHour].map(([hour, count]) => ({ hour, customersServed: count })),
      revenue: 0, revenueStatus: "not-modeled", currency: operation.currency, revenueByHour: [],
      bottlenecks: [...resources.values()].filter((resource) => resource.blockedCustomerSeconds > 0)
        .sort((a, b) => b.blockedCustomerSeconds - a.blockedCustomerSeconds || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
        .map((resource) => ({ resource: resource.id, description: `Insufficient available capacity caused ${resource.blockedCustomerSeconds.toFixed(2)} customer-seconds of blocked queue time; observed blocking is not causal bottleneck attribution and multiple resources may block the same wait.` })),
      assumptions,
    };
  }
}

export const discreteEventSimulationEngine = new DiscreteEventSimulationEngine();
