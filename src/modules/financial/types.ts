import type { ArtifactRef, DayType, FinancialResult } from "../../core";

/** Counts of dine-in customers and delivery orders retain their distinct units. */
export interface FinancialDayEstimate {
  dayType: DayType;
  daysPerMonth: number;
  runToDayMultiplier: number;
  startMinute: number;
  durationMinutes: number;
  replicationCount: number;
  seeds: number[];
  runIds: string[];
  meanCompletedDineInCustomersPerRun: number;
  meanCompletedDeliveryOrdersPerRun: number;
  estimatedDineInCustomersPerDay: number;
  estimatedDeliveryOrdersPerDay: number;
}

export interface FinancialAnalysisResult extends FinancialResult {
  status: "conditional-estimate";
  monthlyDineInRevenue: number;
  monthlyDeliveryRevenue: number;
  monthlyDineInCustomers: number;
  monthlyDeliveryOrders: number;
  foodMaterialCost: number;
  paymentFees: number;
  deliveryPlatformFees: number;
  deliveryVariableCost: number;
  deliveryFees: number;
  royaltyCost: number;
  otherVariableCosts: number;
  rent: number;
  otherFixedCosts: number;
  monthlyOperatingProfit: number;
  contribution: number;
  contributionMargin: number | null;
  /** Mixed-channel customer/order counts are valid only at the observed channel mix. */
  breakEvenCustomersOrOrders: number | null;
  breakEvenDailyCustomersOrOrders: number | null;
  breakEvenDailyDineInCustomers: number | null;
  breakEvenDailyDeliveryOrders: number | null;
  observedDailyDineInCustomers: number;
  observedDailyDeliveryOrders: number;
  observedDailyCustomersOrOrders: number;
  observedThroughputMarginPerDay: number | null;
  capacityComparisonBasis: "observed-throughput-at-constant-channel-mix-not-maximum-capacity";
  initialInvestment: number;
  nonRefundableInvestment: number;
  refundableDeposit: number;
  operatingCashContribution: number;
  paybackInvestmentBasis: "non-refundable-investment-excluding-deposit";
  nullReasons: {
    operatingMargin: string | null;
    contributionMargin: string | null;
    breakEven: string | null;
    breakEvenCustomers: string | null;
    estimatedPaybackMonths: string | null;
  };
  conditions: {
    projectRef: ArtifactRef;
    scenarioRef: ArtifactRef | null;
    dineInRevenueUnit: "currency/customer";
    deliveryRevenueUnit: "currency/order";
    averageSpendingPerCustomer: number;
    averageDeliveryOrderValue: number;
    spendingSource: "financial-assumption" | "operation-policy";
    operatingDaysPerMonth: number;
    dayEstimates: FinancialDayEstimate[];
    replicationCount: number;
    replicationAggregation: "mean-within-day-type-then-operating-day-weighted";
    runInputContentKeys: { runId: string; contentKey: string }[];
    laborBasis: "fixed-monthly" | "operation-linked";
    laborResources: { cooks: number; servers: number; cashiers: number; otherStaff: number } | null;
  };
}
