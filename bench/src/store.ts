/**
 * The benchmark store: a synthetic 38-seat sushi bar with a delivery channel.
 * Every number here is an illustrative assumption, not a measurement of a real store.
 */
import type { LayoutElement, OperationPolicy, StoreLayout } from "../../src/core";

export const OPEN_MINUTE = 660;          // 11:00, first admission
export const LAST_ADMISSION_MINUTE = 1260; // 21:00, last admission
export const HORIZON_SECONDS = 11 * 3600;  // observe until 22:00 so most parties finish
export const SLOT_HOURS = Array.from({ length: 11 }, (_, i) => 11 + i); // staffing slots 11:00 ... 21:00

/** 8 counter seats, 4 two-tops, 4 four-tops, 1 six-top. */
export const TABLES = [...Array(8).fill(1), ...Array(4).fill(2), ...Array(4).fill(4), 6] as number[];
export const KITCHEN_SLOTS = 5; // physical stations: never more than 5 dishes cook at once

export const PARTY_SIZES = [
  { size: 1, probability: 0.25 }, { size: 2, probability: 0.40 }, { size: 3, probability: 0.10 },
  { size: 4, probability: 0.20 }, { size: 5, probability: 0.03 }, { size: 6, probability: 0.02 },
];

export const DURATIONS = {
  orderingSeconds: 90, cookingSeconds: 360, servingSeconds: 45,
  diningSeconds: 1500, paymentSeconds: 45, cleaningSeconds: 120,
};
export const PACKAGING_SECONDS = 90;
export const SEATING_PATIENCE_SECONDS = 1200; // a party leaves after 20 minutes at the door
export const DELIVERY_ACCEPT_SECONDS = 900;   // an order not started within 15 minutes is cancelled
export const SERVICE_TIME_CV = 0.35;          // lognormal spread of every service time

/** Per-unit economics in KRW. */
export const ECONOMICS = {
  dineInSpendPerCustomer: 19000, dineInFoodCostRatio: 0.32,
  deliveryOrderValue: 34000, deliveryPlatformFeeRatio: 0.28, deliveryFoodAndPackagingRatio: 0.35,
  hourlyWage: { cooks: 17000, servers: 14000, cashiers: 13000 }, // loaded cost per scheduled hour
};
export const MARGIN = {
  dineInCustomer: ECONOMICS.dineInSpendPerCustomer * (1 - ECONOMICS.dineInFoodCostRatio),
  deliveryOrder: ECONOMICS.deliveryOrderValue * (1 - ECONOMICS.deliveryPlatformFeeRatio - ECONOMICS.deliveryFoodAndPackagingRatio),
};

/** Service levels a policy must meet, pooled over all seeds of a scenario. */
export const SERVICE_LEVELS = {
  dineInLostRateMax: 0.05,
  dineInP90WaitSecondsMax: 900,      // total queueing per customer: door, order, kitchen, serving, payment
  deliveryLostRateMax: 0.05,
  deliveryP90KitchenWaitSecondsMax: 600,
};
export const STAFF_LIMITS = { cooks: [1, 5], servers: [1, 5], cashiers: [1, 2] } as const;

export function storeLayout(): StoreLayout {
  const element = (id: string, type: string, kind: LayoutElement["kind"] = "object"): LayoutElement => ({
    id, type, kind, name: id, confidence: 1, source: "bench", reviewed: true,
    x: 0, y: 0, z: 0, width: 1000, depth: 1000, height: 1000, rotationDegrees: 0,
  });
  return {
    id: "bench-store", revision: 1, schemaVersion: 1, storeId: "bench-store",
    source: { format: "floorplan-json", documentId: "bench", documentVersion: 1, documentRevision: 1 },
    geometry: { units: "mm", coordinateSystem: "x-right-y-down-z-up", bounds: { width: 12000, depth: 9000 }, elements: [
      element("entrance", "door", "door"), element("kitchen", "counter"), element("service", "counter"),
      ...TABLES.map((_, index) => element(`table-${index}`, "table")),
    ] },
    totalAreaM2: 108, totalAreaBasis: "bounds-estimate", hallAreaM2: null, kitchenAreaM2: null, serviceAreaM2: null,
    tableCount: TABLES.length, chairCount: 0, confirmedCapacity: TABLES.reduce((sum, size) => sum + size, 0),
    assignments: { entranceIds: ["entrance"], tables: TABLES.map((capacity, index) => ({ elementId: `table-${index}`, capacity })),
      kitchenStationIds: ["kitchen"], serviceStationIds: ["service"], zoneRoles: [] },
    assumptions: [], issues: [],
  };
}

/** Initial capacities are placeholders; the policy's hourly staffing replaces them at t = 0. */
export function operationPolicy(): OperationPolicy {
  return {
    model: { id: "restaurant", version: "1.0.0" },
    operatingWindows: (["weekday", "weekend", "holiday"] as const).map(dayType => ({ dayType, startMinute: OPEN_MINUTE, endMinute: LAST_ADMISSION_MINUTE })),
    resources: { cooks: 1, servers: 1, cashiers: 1, kitchenConcurrentOrders: KITCHEN_SLOTS },
    durations: { ...DURATIONS },
    maxQueueWaitSeconds: SEATING_PATIENCE_SECONDS,
    partySizeDistribution: PARTY_SIZES.map(item => ({ ...item })),
    averageSpendingPerCustomer: ECONOMICS.dineInSpendPerCustomer, currency: "KRW",
    delivery: { packagingSeconds: PACKAGING_SECONDS, maxQueueWaitSeconds: DELIVERY_ACCEPT_SECONDS },
    assumptions: [{ id: "bench-store", description: "Synthetic benchmark store; illustrative, not calibrated to a real restaurant", value: "synthetic", unit: "model", source: "restaurant-ops-bench" }],
  };
}
