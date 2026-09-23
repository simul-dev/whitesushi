import {
  canonicalJson, updateProject, updateProjectBase,
  type DemandParameters, type FinancialAssumption, type MarketProfile, type OperationPolicy,
  type SimulationConfig,
} from "../core";
import { createDefaultDemandParameters } from "../modules/demand";
import { createRestaurantPolicy } from "../modules/operation";
import { createSamplePlan } from "../modules/space/sample";
import { type FloorPlan, type LayoutMapping } from "../modules/space";
import { createSpaceProject, publishSpaceDocument, type SpaceProjectSession } from "./spaceProject";

export interface CandidateDetails {
  projectName: string; brandName: string; address: string; notes: string; knownAreaM2: number | null;
}
export const isValidCandidateArea = (area: number | null) => area === null || (Number.isFinite(area) && area >= 0.1);
export interface WorkflowConfiguration {
  demandParameters: DemandParameters;
  operation: OperationPolicy;
  simulation: SimulationConfig;
  financial: FinancialAssumption;
}
export interface CustomScenarioInputs {
  conversionChangePercent: number; spendingChangePercent: number; cooks: number; kitchenConcurrentOrders: number;
}
export type SensitivityChoice = "conversion" | "seats" | "kitchen" | "spending";

export function createWorkflowConfiguration(): WorkflowConfiguration {
  const demandParameters = createDefaultDemandParameters({ categoryParticipationRate: 0.25, brandShare: 0.2, visitConversionRate: 0.25,
    deliveryOrdersByHour: (["weekday", "weekend", "holiday"] as const).flatMap(dayType => Array.from({ length: 24 }, (_, hour) => ({
      dayType, hour, expectedOrdersPerHour: hour >= 11 && hour < 21 ? 3 : 0, distribution: "poisson" as const,
    }))),
  });
  return {
    demandParameters,
    operation: createRestaurantPolicy({ averageSpendingPerCustomer: 22000, delivery: { packagingSeconds: 60, maxQueueWaitSeconds: 1800 } }),
    simulation: { seed: 1001, startMinute: 660, durationSeconds: 36000, dayType: "weekday", replications: 3 },
    financial: {
      id: "candidate-financial", revision: 1, currency: "KRW", operatingDaysPerMonth: 26,
      operatingDayMix: [{ dayType: "weekday", daysPerMonth: 26, runToDayMultiplier: 1 }],
      averageSpendingPerCustomer: 22000, averageDeliveryOrderValue: 28000,
      foodCostRatio: 0.35, royaltyRatio: 0.02, deliveryFeeRatio: 0.15, paymentFeeRatio: 0.025, deliveryVariableCostPerOrder: 800,
      monthlyRent: 3000000, monthlyLabor: 8000000, monthlyUtilities: 800000, monthlyMarketing: 300000, monthlyOtherFixed: 200000,
      monthlyMaintenance: 100000, monthlyInsurance: 100000,
      initialCapex: 0, initialFranchiseFee: 10000000, initialInteriorCost: 60000000, initialEquipmentCost: 20000000,
      initialOtherInvestment: 5000000, refundableDeposit: 30000000,
      assumptions: [{ id: "workflow-example", description: "검토용 예시 가격·비용입니다. 실제 후보지와 브랜드 조건으로 수정하세요.", value: true, unit: "example", source: "user-editable-demo" }],
    },
  };
}

/** Explicit mapping of the bundled demonstration drawing, never applied to imported drawings. */
export function sampleWorkflowSession(now: string): SpaceProjectSession {
  const plan = createSamplePlan();
  return createSpaceProject({ projectId: "candidate-project", name: "새 후보점", createdAt: now,
    site: { id: "candidate-site", revision: 1, name: "새 후보점", address: null, coordinates: null, timeZone: "Asia/Seoul" },
    documentId: "candidate-floorplan", layoutId: "candidate-layout", plan,
    mapping: { entranceIds: ["door-entry"], kitchenStationIds: ["range"], serviceStationIds: ["self-bar"],
      tableCapacities: Object.fromEntries(plan.objects.filter(o => o.type === "table").map(o => [o.id, 4])),
      zoneRoles: { "zone-dining": "hall", "zone-kitchen": "kitchen", "zone-corridor": "service" },
    },
  });
}

export function sanitizeMapping(plan: FloorPlan, mapping: LayoutMapping): LayoutMapping {
  const objects = new Set(plan.objects.map(e => e.id)), doors = new Set(plan.doors.map(e => e.id));
  const tables = new Set(plan.objects.filter(e => e.type === "table").map(e => e.id));
  const zones = new Set(plan.zones.map(e => e.id));
  return {
    entranceIds: (mapping.entranceIds ?? []).filter(id => doors.has(id)),
    kitchenStationIds: (mapping.kitchenStationIds ?? []).filter(id => objects.has(id)),
    serviceStationIds: (mapping.serviceStationIds ?? []).filter(id => objects.has(id)),
    tableCapacities: Object.fromEntries(Object.entries(mapping.tableCapacities ?? {}).filter(([id]) => tables.has(id))),
    zoneRoles: Object.fromEntries(Object.entries(mapping.zoneRoles ?? {}).filter(([id]) => zones.has(id))),
  };
}

/** Checkpoint actual editor output and complete typed settings before an analysis. */
export function checkpointWorkflow(input: {
  session: SpaceProjectSession; candidate: CandidateDetails; plan: FloorPlan; mapping: LayoutMapping;
  configuration: WorkflowConfiguration; market: MarketProfile | null; now: string;
}): SpaceProjectSession {
  if (!input.candidate.projectName.trim() || !input.candidate.brandName.trim() || !input.candidate.address.trim())
    throw new Error("후보지에서 프로젝트 이름, 브랜드와 주소를 입력해 주세요.");
  if (!isValidCandidateArea(input.candidate.knownAreaM2)) throw new Error("후보지 면적은 0.1 m² 이상으로 입력하거나 비워 주세요.");
  let session = publishSpaceDocument(input.session, input.plan, { updatedAt: input.now, mapping: sanitizeMapping(input.plan, input.mapping) });
  let project = session.project;
  const nextSite = { ...project.site, name: input.candidate.projectName.trim(), address: input.candidate.address.trim() };
  if (canonicalJson(nextSite) !== canonicalJson(project.site)) {
    nextSite.revision++;
    project = updateProject(project, { name: input.candidate.projectName.trim(), site: nextSite }, input.now);
  }
  project = updateProjectBase(project, { ...structuredClone(input.configuration), market: input.market, demand: null }, input.now);
  return { ...session, project };
}

/** UI freshness keys include exact effective values; historical outputs are never relabelled. */
export function workflowInputKeys(input: {
  candidate: CandidateDetails; plan: FloorPlan; mapping: LayoutMapping; configuration: WorkflowConfiguration;
  market: MarketProfile | null; custom: CustomScenarioInputs; sensitivity: SensitivityChoice;
}) {
  const { candidate, configuration: c } = input;
  const site = canonicalJson({ name: candidate.projectName.trim(), address: candidate.address.trim() });
  const market = canonicalJson({ site, profile: input.market });
  const demand = canonicalJson({ market, parameters: c.demandParameters });
  // The raster underlay is irrelevant to DES, while geometry and source identity are retained.
  const { overlay: _overlay, ...geometry } = input.plan;
  const operation = canonicalJson({ demand, geometry, mapping: input.mapping, operation: c.operation, simulation: c.simulation });
  const financial = canonicalJson({ operation, financial: c.financial });
  return { site, market, demand, operation, financial,
    comparison: canonicalJson({ financial, custom: input.custom }), sensitivity: canonicalJson({ financial, parameter: input.sensitivity }) };
}
