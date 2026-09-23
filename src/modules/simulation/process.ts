import { DomainValidationError, type OperationProcess } from "../../core";

const invalid = (path: string, message: string): never => { throw new DomainValidationError(`process.${path}`, message); };
const count = (value: number, path: string, minimum = 0) => {
  if (!Number.isSafeInteger(value) || value < minimum) invalid(path, `must be an integer >= ${minimum}`);
};
const duration = (value: number, path: string, positive = false) => {
  if (!Number.isFinite(value) || value < 0 || (positive && value === 0)) invalid(path, "invalid duration");
};

/** Reject ambiguous acquisition, missing references, and cycles before scheduling. */
export function validateOperationProcess(process: OperationProcess): void {
  if (process.schemaVersion !== 1) invalid("schemaVersion", "unsupported version");
  const resources = new Map(process.resources.map((resource) => [resource.id, resource]));
  if (resources.size !== process.resources.length) invalid("resources", "duplicate resource id");
  for (const resource of process.resources) {
    if (!resource.id.trim()) invalid("resource.id", "required");
    count(resource.capacityUnits, "capacityUnits");
    if (resource.category !== undefined && !["table", "kitchen", "staff", "other"].includes(resource.category)) invalid("category", "unknown category");
    if (resource.unitCapacities) {
      if (resource.unitCapacities.length !== resource.capacityUnits) invalid("unitCapacities", "one capacity per exclusive resource unit required");
      resource.unitCapacities.forEach((capacity) => count(capacity, "unitCapacities", 1));
    }
  }
  const sizes = process.partySizeDistribution ?? [{ size: 1, probability: 1 }];
  if (!sizes.length || new Set(sizes.map((item) => item.size)).size !== sizes.length) invalid("partySizeDistribution", "empty or duplicate sizes");
  sizes.forEach((item) => { count(item.size, "partySize", 1); if (!Number.isFinite(item.probability) || item.probability < 0 || item.probability > 1) invalid("probability", "must be in [0, 1]"); });
  if (Math.abs(sizes.reduce((sum, item) => sum + item.probability, 0) - 1) > 1e-9) invalid("partySizeDistribution", "probabilities must sum to one");
  const stages = new Map(process.stages.map((stage) => [stage.id, stage]));
  if (!stages.size || stages.size !== process.stages.length || !stages.has(process.startStageId)) invalid("stages", "missing start or duplicate stages");
  for (const stage of process.stages) {
    if (!stage.id.trim()) invalid("stage.id", "required");
    if (stage.duration.kind === "constant") duration(stage.duration.seconds, "duration");
    else if (stage.duration.kind === "exponential") duration(stage.duration.meanSeconds, "duration", true);
    else invalid("duration", "unsupported distribution");
    if (stage.outcome !== null && stage.outcome !== "served" && stage.outcome !== "lost") invalid("outcome", "unknown outcome");
    if ((stage.nextStageId === null) !== (stage.outcome !== null)) invalid("outcome", "only terminal stages classify outcomes, and every terminal must classify");
    if (stage.nextStageId !== null && !stages.has(stage.nextStageId)) invalid("nextStageId", "missing stage");
    if (stage.queue) {
      duration(stage.queue.maxWaitSeconds, "queue.maxWaitSeconds");
      if (!stages.has(stage.queue.timeoutStageId)) invalid("queue.timeoutStageId", "missing stage");
    }
    if (new Set(stage.requirements.map((item) => item.resourceId)).size !== stage.requirements.length) invalid("requirements", "duplicate resource in stage");
    for (const requirement of stage.requirements) {
      const resource = resources.get(requirement.resourceId);
      if (!resource) invalid("requirements", "unknown resource");
      count(requirement.units, "requirement.units", 1);
      if (!["stage-end", "process-end"].includes(requirement.release)) invalid("requirement.release", "unknown release policy");
      if (requirement.unitsPerCustomer !== undefined && typeof requirement.unitsPerCustomer !== "boolean") invalid("unitsPerCustomer", "must be boolean");
      if (requirement.minimumUnitCapacity !== undefined && (requirement.minimumUnitCapacity !== "party-size" || !resource!.unitCapacities)) invalid("minimumUnitCapacity", "requires exclusive resource units and party-size selector");
    }
  }
  const done = new Set<string>(), visiting = new Set<string>();
  function visit(id: string) {
    if (visiting.has(id)) invalid("stages", "cycles are not supported");
    if (done.has(id)) return;
    visiting.add(id);
    const stage = stages.get(id)!;
    if (stage.nextStageId) visit(stage.nextStageId);
    if (stage.queue) visit(stage.queue.timeoutStageId);
    visiting.delete(id); done.add(id);
  }
  process.stages.forEach((stage) => visit(stage.id));
  // Propagate held resources through the DAG. A repeated process-long acquisition would leak capacity.
  const heldOnEntry = new Map<string, Set<string>>();
  const order = [...done].reverse();
  heldOnEntry.set(process.startStageId, new Set());
  for (const id of order) {
    const held = heldOnEntry.get(id);
    if (!held) continue;
    const stage = stages.get(id)!;
    if (stage.requirements.some((item) => held.has(item.resourceId))) invalid("requirements", "resource already held from an earlier stage");
    const propagate = (next: string, values: Set<string>) => heldOnEntry.set(next, new Set([...(heldOnEntry.get(next) ?? []), ...values]));
    if (stage.nextStageId) propagate(stage.nextStageId, new Set([...held, ...stage.requirements.filter((item) => item.release === "process-end").map((item) => item.resourceId)]));
    if (stage.queue) propagate(stage.queue.timeoutStageId, held);
  }
}
