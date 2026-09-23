import {
  DomainValidationError, validateLayout, validateOperation,
  type DomainIssue, type OperationModel, type OperationOverride, type OperationPolicy,
  type OperationProcess, type StoreLayout,
} from "../../core";

export const RESTAURANT_MODEL = Object.freeze({ id: "restaurant", version: "1.0.0" } as const);

/** Explicit demo defaults; callers should calibrate times and resource counts. */
export function createRestaurantPolicy(overrides: OperationOverride = {}): OperationPolicy {
  const policy: OperationPolicy = {
    model: { ...RESTAURANT_MODEL },
    operatingWindows: ["weekday", "weekend", "holiday"].map((dayType) => ({
      dayType: dayType as "weekday" | "weekend" | "holiday", startMinute: 660, endMinute: 1260,
    })),
    partySizeDistribution: [{ size: 1, probability: 1 }],
    maxQueueWaitSeconds: 1800,
    averageSpendingPerCustomer: 0,
    currency: "KRW",
    assumptions: [{ id: "restaurant-defaults", description: "Illustrative operating defaults, not calibrated restaurant measurements", value: "demo", unit: "model", source: "restaurant/1.0.0" }],
    ...structuredClone(overrides),
    resources: { cooks: 2, servers: 2, cashiers: 1, kitchenConcurrentOrders: 4, ...overrides.resources },
    durations: { orderingSeconds: 90, cookingSeconds: 600, servingSeconds: 45, diningSeconds: 1200, paymentSeconds: 45, cleaningSeconds: 90, ...overrides.durations },
  };
  validateOperation(policy);
  return policy;
}

/** The industry model owns stage names and table/staff policy; the scheduler does not. */
export class RestaurantOperationModel implements OperationModel {
  readonly descriptor = RESTAURANT_MODEL;

  validate({ layout, policy }: { layout: StoreLayout; policy: OperationPolicy }): DomainIssue[] {
    const issues: DomainIssue[] = [];
    const add = (code: string, path: string, message: string) => issues.push({ code, path, message });
    try { validateLayout(layout); validateOperation(policy); }
    catch (error) { add("invalid-operation-input", "operation", error instanceof Error ? error.message : String(error)); return issues; }
    if (policy.model.id !== this.descriptor.id || policy.model.version !== this.descriptor.version)
      add("model-version-mismatch", "operation.model", "Use the policy's matching restaurant model version");
    if (!layout.tableCount || layout.confirmedCapacity === null || layout.confirmedCapacity <= 0 ||
      layout.assignments.tables.length !== layout.tableCount || layout.assignments.tables.some((table) => table.capacity === null || table.capacity <= 0))
      add("unconfirmed-tables", "layout.assignments.tables", "Confirm a positive capacity for every table");
    if (!layout.assignments.entranceIds.length) add("unassigned-entrance", "layout.assignments.entranceIds", "Assign a customer entrance");
    if (policy.resources.kitchenConcurrentOrders > 0 && !layout.assignments.kitchenStationIds.length)
      add("unassigned-kitchen", "layout.assignments.kitchenStationIds", "Assign at least one kitchen station");
    if ((policy.resources.servers > 0 || policy.resources.cashiers > 0) && !layout.assignments.serviceStationIds.length)
      add("unassigned-service", "layout.assignments.serviceStationIds", "Assign at least one service station");
    return issues;
  }

  defineProcess(input: { layout: StoreLayout; policy: OperationPolicy }): OperationProcess {
    const issues = this.validate(input);
    if (issues.length) throw new DomainValidationError(issues[0].path, issues.map((issue) => issue.message).join("; "));
    const { layout, policy } = input;
    const held = (resourceId: string, units = 1) => ({ resourceId, units, release: "process-end" as const });
    const transient = (resourceId: string) => ({ resourceId, units: 1, release: "stage-end" as const });
    const stage = (id: string, seconds: number, requirements: OperationProcess["stages"][number]["requirements"], nextStageId: string | null): OperationProcess["stages"][number] =>
      ({ id, duration: { kind: "constant", seconds }, requirements, nextStageId, queue: null, outcome: null });
    const queueWait = policy.maxQueueWaitSeconds === undefined ? 1800 : policy.maxQueueWaitSeconds;
    const seating = stage("seating", 0, [
      { ...held("tables"), minimumUnitCapacity: "party-size" },
      { ...held("seats"), unitsPerCustomer: true },
    ], "ordering");
    seating.queue = queueWait === null ? null : { maxWaitSeconds: queueWait, timeoutStageId: "lost" };
    return {
      schemaVersion: 1, model: { ...this.descriptor }, startStageId: "seating",
      partySizeDistribution: structuredClone(policy.partySizeDistribution ?? [{ size: 1, probability: 1 }]),
      resources: [
        { id: "tables", capacityUnits: layout.tableCount, category: "table", unitCapacities: layout.assignments.tables.map((table) => table.capacity!) },
        { id: "seats", capacityUnits: layout.confirmedCapacity!, category: "other" },
        { id: "kitchen", capacityUnits: policy.resources.kitchenConcurrentOrders, category: "kitchen" },
        { id: "cooks", capacityUnits: policy.resources.cooks, category: "staff" },
        { id: "servers", capacityUnits: policy.resources.servers, category: "staff" },
        { id: "cashiers", capacityUnits: policy.resources.cashiers, category: "staff" },
      ],
      stages: [
        seating,
        stage("ordering", policy.durations.orderingSeconds, [transient("servers")], "cooking"),
        stage("cooking", policy.durations.cookingSeconds, [transient("kitchen"), transient("cooks")], "serving"),
        stage("serving", policy.durations.servingSeconds, [transient("servers")], "dining"),
        stage("dining", policy.durations.diningSeconds, [], "payment"),
        stage("payment", policy.durations.paymentSeconds, [transient("cashiers")], "cleaning"),
        stage("cleaning", policy.durations.cleaningSeconds, [transient("servers")], "exit"),
        { ...stage("exit", 0, [], null), outcome: "served" },
        { ...stage("lost", 0, [], null), outcome: "lost" },
      ],
    };
  }
}

export const restaurantOperationModel = new RestaurantOperationModel();
