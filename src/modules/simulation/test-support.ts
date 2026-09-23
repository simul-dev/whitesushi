import {
  canonicalJson, type DemandProfile, type LayoutElement, type MarketProfile, type OperationPolicy,
  type SimulationConfig, type SimulationSnapshot, type StoreLayout,
} from "../../core";
import { discreteEventSimulationEngine } from "./index";

/** Synthetic contract fixture, independent of the user floor plan and PDF. */
export function fixtureLayout(capacities = [2, 2, 2, 2]): StoreLayout {
  const element = (id: string, type: string, kind: LayoutElement["kind"] = "object"): LayoutElement => ({
    id, type, kind, name: id, confidence: 1, source: "test", reviewed: true,
    x: 0, y: 0, z: 0, width: 1000, depth: 1000, height: 1000, rotationDegrees: 0,
  });
  return {
    id: "layout", revision: 1, schemaVersion: 1, storeId: "site",
    source: { format: "floorplan-json", documentId: "fixture", documentVersion: 1, documentRevision: 1 },
    geometry: { units: "mm", coordinateSystem: "x-right-y-down-z-up", bounds: { width: 10000, depth: 10000 }, elements: [
      element("entrance", "door", "door"), element("kitchen", "counter"), element("service", "counter"), ...capacities.map((_, index) => element(`table-${index}`, "table")),
    ] },
    totalAreaM2: 100, totalAreaBasis: "bounds-estimate", hallAreaM2: null, kitchenAreaM2: null, serviceAreaM2: null,
    tableCount: capacities.length, chairCount: 0, confirmedCapacity: capacities.reduce((sum, size) => sum + size, 0),
    assignments: { entranceIds: ["entrance"], tables: capacities.map((capacity, index) => ({ elementId: `table-${index}`, capacity })), kitchenStationIds: ["kitchen"], serviceStationIds: ["service"], zoneRoles: [] },
    assumptions: [], issues: [],
  };
}

export function fixturePolicy(): OperationPolicy {
  return {
    model: { id: "restaurant", version: "1.0.0" },
    operatingWindows: [{ dayType: "weekday", startMinute: 0, endMinute: 1440 }],
    resources: { cooks: 100, servers: 100, cashiers: 100, kitchenConcurrentOrders: 100 },
    durations: { orderingSeconds: 1, cookingSeconds: 1, servingSeconds: 1, diningSeconds: 300, paymentSeconds: 1, cleaningSeconds: 1 },
    maxQueueWaitSeconds: null,
    partySizeDistribution: [{ size: 1, probability: 1 }],
    averageSpendingPerCustomer: 0, currency: "KRW", assumptions: [],
  };
}

export function fixtureSnapshot(options: {
  rate?: number; capacities?: number[]; policy?: OperationPolicy; config?: Partial<SimulationConfig>; distribution?: "poisson" | "deterministic";
} = {}): SimulationSnapshot {
  const demand: DemandProfile = {
    id: "demand", revision: 1, model: { id: "fixture", version: "1" }, provenance: { kind: "demo", source: "test" },
    lineage: { marketRef: { id: "market", revision: 1 }, marketContentKey: "fixture", parametersContentKey: "fixture" },
    buckets: Array.from({ length: 24 }, (_, hour) => ({ dayType: "weekday", hour, expectedCustomersPerHour: options.rate ?? 100, distribution: options.distribution ?? "deterministic" })), assumptions: [],
  };
  const market: MarketProfile = {
    id: "market", revision: 1, siteRef: { id: "site", revision: 1 }, siteContentKey: "fixture", provider: { id: "fixture", version: "1" },
    provenance: { kind: "demo", source: "test" }, period: { from: "2026-09-01T00:00:00Z", to: "2026-09-02T00:00:00Z" }, buckets: [], nearbyBusinesses: [], assumptions: [],
  };
  const snapshot: SimulationSnapshot = {
    schemaVersion: 1, projectRef: { id: "project", revision: 1 }, scenarioRef: null, engine: discreteEventSimulationEngine.descriptor,
    input: { layout: fixtureLayout(options.capacities), demand, operation: options.policy ?? fixturePolicy(), config: { seed: 42, durationSeconds: 7200, startMinute: 0, dayType: "weekday", replications: 1, ...options.config } },
    lineage: { site: { id: "site", revision: 1, name: "Test", address: null, coordinates: null, timeZone: "Asia/Seoul" }, market, demandParameters: {
      categoryParticipationRate: 1, brandShare: 1, visitConversionRate: 1, weekdayMultiplier: 1, weekendMultiplier: 1, lunchMultiplier: 1, dinnerMultiplier: 1, weatherEventMultiplier: 1, deliveryRatio: 0,
    } }, contentKey: "", integrityKey: "",
  };
  return sealSnapshot(snapshot);
}

export function sealSnapshot(snapshot: SimulationSnapshot): SimulationSnapshot {
  snapshot.contentKey = canonicalJson({ engine: snapshot.engine, input: snapshot.input, lineage: snapshot.lineage });
  snapshot.integrityKey = canonicalJson({ schemaVersion: snapshot.schemaVersion, projectRef: snapshot.projectRef, scenarioRef: snapshot.scenarioRef, contentKey: snapshot.contentKey });
  return snapshot;
}
