/** JSON-safe module contracts. No UI, browser, PDF or renderer dependency. */
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export interface ArtifactRef { id: string; revision: number }
export interface ModuleVersion { id: string; version: string }
export interface DomainIssue { code: string; path: string; message: string }
export interface Assumption { id: string; description: string; value: JsonValue; unit: string; source: string }
export interface Provenance {
  kind: "observed" | "manual" | "derived" | "demo";
  source: string;
  observedAt?: string;
}
export interface PointMm { x: number; y: number }
export interface LayoutElement {
  id: string;
  kind: "wall" | "door" | "window" | "zone" | "object";
  type: string;
  name: string;
  confidence: number;
  source: string;
  reviewed: boolean;
  wallId?: string;
  x: number; y: number; z: number;
  width: number; depth: number; height: number;
  rotationDegrees: number;
  polygon?: PointMm[];
}
export interface StoreLayout extends ArtifactRef {
  schemaVersion: 1;
  storeId: string;
  source: { format: "floorplan-json"; documentId: string; documentVersion: number | string; documentRevision: number };
  geometry: { units: "mm"; coordinateSystem: "x-right-y-down-z-up"; bounds: { width: number; depth: number }; outline?: PointMm[]; elements: LayoutElement[] };
  totalAreaM2: number;
  totalAreaBasis: "outline" | "bounds-estimate";
  hallAreaM2: number | null;
  kitchenAreaM2: number | null;
  serviceAreaM2: number | null;
  tableCount: number;
  chairCount: number;
  confirmedCapacity: number | null;
  assignments: {
    entranceIds: string[];
    tables: { elementId: string; capacity: number | null }[];
    kitchenStationIds: string[];
    serviceStationIds: string[];
    zoneRoles: { elementId: string; role: "hall" | "kitchen" | "service" | "other" }[];
  };
  assumptions: Assumption[];
  issues: DomainIssue[];
}
export interface Site extends ArtifactRef {
  name: string;
  address: string | null;
  coordinates: { latitude: number; longitude: number } | null;
  timeZone: string;
}
export type DayType = "weekday" | "weekend" | "holiday";
/** Counts cover one hour; population and passers-by are observations, not arrivals. */
export interface MarketBucket { dayType: DayType; hour: number; population: number | null; footTrafficPersons: number | null }
export interface NearbyBusiness { id: string; name: string; category: string; distanceMeters: number; competitor: boolean }
export interface MarketProfile extends ArtifactRef {
  siteRef: ArtifactRef;
  siteContentKey: string;
  provider: ModuleVersion;
  provenance: Provenance;
  period: { from: string; to: string };
  buckets: MarketBucket[];
  nearbyBusinesses: NearbyBusiness[];
  assumptions: Assumption[];
}
export interface DemandParameters {
  categoryParticipationRate: number;
  brandShare: number;
  visitConversionRate: number;
  weekdayMultiplier: number;
  weekendMultiplier: number;
  lunchMultiplier: number;
  dinnerMultiplier: number;
  weatherEventMultiplier: number;
  deliveryRatio: number;
  /** Optional explicit day/hour adjustments; omitted buckets use 1. */
  hourlyMultipliers?: { dayType: DayType; hour: number; multiplier: number }[];
  /** Independent orders/hour, never subtracted from dine-in demand. Requires deliveryRatio=0. */
  deliveryOrdersByHour?: DeliveryDemandBucket[];
}
export interface DeliveryDemandBucket {
  dayType: DayType;
  hour: number;
  expectedOrdersPerHour: number;
  distribution: "poisson" | "deterministic";
}
/** Arrivals are individual customers/hour (not customer parties). */
export interface DemandBucket {
  dayType: DayType;
  hour: number;
  expectedCustomersPerHour: number;
  distribution: "poisson" | "deterministic";
}
export interface DemandProfile extends ArtifactRef {
  model: ModuleVersion;
  provenance: Provenance;
  lineage: { marketRef: ArtifactRef; marketContentKey: string; parametersContentKey: string };
  buckets: DemandBucket[];
  deliveryBuckets?: DeliveryDemandBucket[];
  assumptions: Assumption[];
}
export interface OperatingWindow { dayType: DayType; startMinute: number; endMinute: number }
export interface ServiceDurations {
  orderingSeconds: number; cookingSeconds: number; servingSeconds: number;
  diningSeconds: number; paymentSeconds: number; cleaningSeconds: number;
}
export interface OperationPolicy {
  model: ModuleVersion;
  operatingWindows: OperatingWindow[];
  resources: { cooks: number; servers: number; cashiers: number; kitchenConcurrentOrders: number };
  durations: ServiceDurations;
  averageSpendingPerCustomer: number;
  currency: string;
  assumptions: Assumption[];
  /** Individual-customer demand is converted to party arrivals using the mean size. */
  partySizeDistribution?: { size: number; probability: number }[];
  /** Admission queue patience in seconds; null means no timeout. */
  maxQueueWaitSeconds?: number | null;
  /** Packaging consumes cooks; cooking shares the dine-in kitchen and cooks. */
  delivery?: { packagingSeconds: number; maxQueueWaitSeconds: number | null };
}
/** Declarative industry process interpreted by a UI-independent event scheduler. */
export type DurationDistribution = { kind: "constant"; seconds: number } | { kind: "exponential"; meanSeconds: number };
export interface OperationProcess {
  schemaVersion: 1;
  model: ModuleVersion;
  startStageId: string;
  arrivalStreams?: { id: string; channel: "dine-in" | "delivery"; startStageId: string }[];
  partySizeDistribution?: { size: number; probability: number }[];
  /** Capacity units are defined by the model (e.g. server, kitchen slot, seat). */
  resources: {
    id: string;
    capacityUnits: number;
    category?: "table" | "kitchen" | "staff" | "other";
    /** Exclusive-unit capacities (e.g. seats on each table), indexed per unit. */
    unitCapacities?: number[];
  }[];
  stages: {
    id: string;
    duration: DurationDistribution;
    /** Domain metric labels interpreted without hard-coded restaurant stage IDs. */
    queueMetric?: "food-wait" | "kitchen-wait";
    /** Acquire atomically in FIFO order; release after this stage or process exit. */
    requirements: {
      resourceId: string; units: number; release: "stage-end" | "process-end";
      unitsPerCustomer?: boolean;
      minimumUnitCapacity?: "party-size";
    }[];
    nextStageId: string | null;
    /** null means wait indefinitely. An explicit timeout routes to timeoutStageId. */
    queue: { maxWaitSeconds: number; timeoutStageId: string } | null;
    /** Only terminal stages classify served/lost customers; intermediate stages use null. */
    outcome: "served" | "lost" | null;
  }[];
}
export interface SimulationConfig {
  seed: number;
  durationSeconds: number;
  startMinute: number;
  dayType: DayType;
  replications: number;
}
export interface FinancialAssumption extends ArtifactRef {
  currency: string;
  operatingDaysPerMonth: number;
  foodCostRatio: number;
  royaltyRatio: number;
  deliveryFeeRatio: number;
  monthlyRent: number;
  monthlyLabor: number;
  monthlyUtilities: number;
  monthlyMarketing: number;
  monthlyOtherFixed: number;
  initialCapex: number;
  initialFranchiseFee: number;
  initialInteriorCost: number;
  /** Currency/customer and currency/order respectively; revenue uses completed units. */
  averageSpendingPerCustomer?: number;
  averageDeliveryOrderValue?: number;
  paymentFeeRatio?: number;
  deliveryVariableCostPerOrder?: number;
  monthlyMaintenance?: number;
  monthlyInsurance?: number;
  initialEquipmentCost?: number;
  initialOtherInvestment?: number;
  refundableDeposit?: number;
  /** Explicit conversion from one observed run to a day, weighted by operating days. */
  operatingDayMix?: { dayType: DayType; daysPerMonth: number; runToDayMultiplier: number }[];
  labor?: { mode: "fixed-monthly" } | {
    mode: "operation-linked";
    monthlyCostPerCook: number;
    monthlyCostPerServer: number;
    monthlyCostPerCashier: number;
    otherStaffCount: number;
    monthlyCostPerOtherStaff: number;
  };
  assumptions: Assumption[];
}
export interface ProjectConfiguration {
  layoutRef: ArtifactRef | null;
  market: MarketProfile | null;
  demandParameters: DemandParameters | null;
  demand: DemandProfile | null;
  operation: OperationPolicy | null;
  simulation: SimulationConfig | null;
  financial: FinancialAssumption | null;
}
export type OperationOverride = Omit<Partial<OperationPolicy>, "resources" | "durations"> & {
  resources?: Partial<OperationPolicy["resources"]>;
  durations?: Partial<ServiceDurations>;
};
/** Omitted = inherit. null = clear. Arrays replace, never concatenate. */
export interface ScenarioOverrides {
  layoutRef?: ArtifactRef | null;
  market?: MarketProfile | null;
  demandParameters?: Partial<DemandParameters> | null;
  demand?: DemandProfile | null;
  operation?: OperationOverride | null;
  simulation?: Partial<SimulationConfig> | null;
  financial?: Partial<FinancialAssumption> | null;
}
export interface Scenario extends ArtifactRef {
  projectId: string;
  name: string;
  overrides: ScenarioOverrides;
  createdAt: string;
  updatedAt: string;
}
export interface Project extends ArtifactRef {
  schemaVersion: 1;
  name: string;
  site: Site;
  layouts: StoreLayout[];
  base: ProjectConfiguration;
  scenarios: Scenario[];
  createdAt: string;
  updatedAt: string;
}
export interface ResolvedScenario {
  projectRef: ArtifactRef;
  scenarioRef: ArtifactRef | null;
  site: Site;
  configuration: ProjectConfiguration;
  layout: StoreLayout | null;
}
export interface SimulationInput {
  layout: StoreLayout;
  demand: DemandProfile;
  operation: OperationPolicy;
  config: SimulationConfig;
}
export interface SimulationSnapshot {
  schemaVersion: 1;
  projectRef: ArtifactRef;
  scenarioRef: ArtifactRef | null;
  engine: ModuleVersion;
  input: SimulationInput;
  /** Includes exact upstream observations/parameters to reproduce demand. */
  lineage: { site: Site; market: MarketProfile; demandParameters: DemandParameters };
  /** Canonical JSON, not a collision-prone short hash. Includes values and versions. */
  contentKey: string;
  /** Integrity of provenance as well as content; not used for freshness comparison. */
  integrityKey: string;
}
export interface SimulationResult {
  runId: string;
  customersArrived: number; customersServed: number; customersLost: number;
  averageWaitingSeconds: number; maxWaitingSeconds: number;
  throughputCustomersPerHour: number;
  tableUtilization: number; kitchenUtilization: number; staffUtilization: number;
  averageCustomerTimeInSystemSeconds: number;
  revenue: number;
  currency: string;
  revenueByHour: { hour: number; revenue: number }[];
  bottlenecks: { resource: string; description: string }[];
  assumptions: Assumption[];
  /** Censored customers still in the process at the observation horizon. */
  customersUnfinished?: number;
  hourlyThroughput?: { hour: number; customersServed: number }[];
  resourceUtilization?: { resourceId: string; capacityUnits: number; utilization: number }[];
  /** Numeric revenue fields remain zero for compatibility when no financial model ran. */
  revenueStatus?: "not-modeled";
  averageDineInFoodWaitingSeconds?: number;
  maxDineInFoodWaitingSeconds?: number;
  delivery?: {
    ordersArrived: number; ordersCompleted: number; ordersLost: number; ordersUnfinished: number;
    throughputOrdersPerHour: number;
    averageKitchenWaitingSeconds: number; maxKitchenWaitingSeconds: number;
    averageTimeInSystemSeconds: number;
    hourlyThroughput: { hour: number; ordersCompleted: number }[];
  };
}
export interface SimulationRun {
  id: string;
  status: "prepared" | "completed" | "failed";
  snapshot: SimulationSnapshot;
  createdAt: string;
  completedAt: string | null;
  result: SimulationResult | null;
  error: string | null;
}
export interface FinancialInput { simulationRuns: SimulationRun[]; assumption: FinancialAssumption }
export interface FinancialResult {
  id: string;
  engine: ModuleVersion;
  input: FinancialInput;
  inputContentKey: string;
  currency: string;
  monthlyRevenue: number; costOfGoodsSold: number; laborCost: number;
  fixedCost: number; variableCost: number; operatingProfit: number;
  operatingMargin: number | null;
  breakEvenRevenue: number | null;
  breakEvenCustomers: number | null;
  estimatedPaybackMonths: number | null;
  assumptions: Assumption[];
}
