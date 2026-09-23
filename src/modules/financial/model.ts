import {
  canonicalJson, completeSimulationRun, DomainValidationError, financialInputContentKey,
  validateFinancial, validateOperation, validateSimulation,
  type FinancialEngine, type FinancialInput, type SimulationRun,
} from "../../core";
import type { FinancialAnalysisResult, FinancialDayEstimate } from "./types";

export const FINANCIAL_ENGINE = Object.freeze({ id: "transparent-financial", version: "1.0.0" } as const);
function fail(path: string, message: string): never { throw new DomainValidationError(path, message); }
const finite = (value: number, path: string): number => {
  if (!Number.isFinite(value)) fail(path, "calculation exceeds finite numeric range");
  return value;
};

function comparableRun(run: SimulationRun, acrossDayTypes: boolean): string {
  const copy = structuredClone(run.snapshot);
  // Actual seed/config are preserved in the result input; only comparison ignores them.
  copy.input.config.seed = 0;
  if (acrossDayTypes) {
    copy.input.config.dayType = "weekday";
    copy.input.config.startMinute = 0;
    copy.input.config.durationSeconds = 1;
  }
  return canonicalJson({
    projectRef: copy.projectRef, scenarioRef: copy.scenarioRef,
    engine: copy.engine, input: copy.input, lineage: copy.lineage,
  });
}

/**
 * Conditional monthly arithmetic. One DES run is one observation, not a month.
 * Replicas are averaged; explicit day mixes and run-to-day multipliers set scaling.
 */
export class TransparentFinancialEngine implements FinancialEngine {
  readonly descriptor = FINANCIAL_ENGINE;

  calculate(input: FinancialInput): FinancialAnalysisResult {
    validateFinancial(input.assumption);
    const inputContentKey = financialInputContentKey(input);
    const assumption = input.assumption, runs = input.simulationRuns;
    if (new Set(runs.map(run => run.id)).size !== runs.length)
      fail("financial.runs", "duplicate run identifiers would overweight replications");
    const first = runs[0];
    const commonKey = comparableRun(first, true);
    for (const run of runs) {
      validateOperation(run.snapshot.input.operation);
      validateSimulation(run.snapshot.input.config);
      if (run.snapshot.input.config.replications !== 1)
        fail("financial.runs", "each completed run must represent exactly one replication");
      if (run.snapshot.input.operation.currency !== assumption.currency)
        fail("financial.currency", "operation and financial currency differ");
      if (!run.completedAt || !run.result)
        fail("financial.runs", "all runs must contain completed results and completion timestamps");
      // Reuse Core conservation/range/reference validation, including delivery when present.
      completeSimulationRun({ ...run, status: "prepared", result: null, completedAt: null, error: null }, run.result, run.completedAt);
      if (comparableRun(run, true) !== commonKey)
        fail("financial.runs", "mixed project, scenario, engine, layout, demand, operation or upstream lineage");
    }
    const mix = assumption.operatingDayMix;
    if (!mix?.length)
      fail("financial.operatingDayMix", "explicit day weights and runToDayMultiplier are required; a partial run is not automatically a full day");
    const runDayTypes = new Set(runs.map(run => run.snapshot.input.config.dayType));
    if (mix.length !== runDayTypes.size || mix.some(entry => !runDayTypes.has(entry.dayType)))
      fail("financial.operatingDayMix", "day mix must cover exactly the simulated day types");

    const dayEstimates: FinancialDayEstimate[] = mix.map(entry => {
      const group = runs.filter(run => run.snapshot.input.config.dayType === entry.dayType);
      const reference = group[0];
      if (group.some(run => comparableRun(run, false) !== comparableRun(reference, false)))
        fail("financial.runs", "replications within each day type must have the same observation horizon and configuration");
      const seeds = group.map(run => run.snapshot.input.config.seed);
      if (new Set(seeds).size !== seeds.length)
        fail("financial.runs", "duplicate seeds within one day type are not independent replications");
      const dineIn = group.reduce((sum, run) => sum + run.result!.customersServed / group.length, 0);
      const delivery = group.reduce((sum, run) => {
        const modeledDelivery = run.result!.delivery;
        const demandHasDelivery = run.snapshot.input.demand.deliveryBuckets?.some(bucket =>
          bucket.dayType === entry.dayType && bucket.expectedOrdersPerHour > 0);
        if (!modeledDelivery && demandHasDelivery)
          fail("financial.delivery", "delivery demand is present but completed delivery results are missing");
        return sum + (modeledDelivery?.ordersCompleted ?? 0) / group.length;
      }, 0);
      return {
        ...structuredClone(entry), startMinute: reference.snapshot.input.config.startMinute,
        durationMinutes: reference.snapshot.input.config.durationSeconds / 60,
        replicationCount: group.length, seeds, runIds: group.map(run => run.id),
        meanCompletedDineInCustomersPerRun: dineIn, meanCompletedDeliveryOrdersPerRun: delivery,
        estimatedDineInCustomersPerDay: finite(dineIn * entry.runToDayMultiplier, "financial.dineInPerDay"),
        estimatedDeliveryOrdersPerDay: finite(delivery * entry.runToDayMultiplier, "financial.deliveryPerDay"),
      };
    });
    const monthlyDineInCustomers = finite(dayEstimates.reduce((sum, day) => sum + day.estimatedDineInCustomersPerDay * day.daysPerMonth, 0), "financial.monthlyDineInCustomers");
    const monthlyDeliveryOrders = finite(dayEstimates.reduce((sum, day) => sum + day.estimatedDeliveryOrdersPerDay * day.daysPerMonth, 0), "financial.monthlyDeliveryOrders");
    const averageSpendingPerCustomer = assumption.averageSpendingPerCustomer ?? first.snapshot.input.operation.averageSpendingPerCustomer;
    if (monthlyDeliveryOrders > 0 && assumption.averageDeliveryOrderValue === undefined)
      fail("financial.averageDeliveryOrderValue", "an explicit order value is required when delivery orders are completed");
    const averageDeliveryOrderValue = assumption.averageDeliveryOrderValue ?? 0;
    const monthlyDineInRevenue = monthlyDineInCustomers * averageSpendingPerCustomer;
    const monthlyDeliveryRevenue = monthlyDeliveryOrders * averageDeliveryOrderValue;
    const monthlyRevenue = monthlyDineInRevenue + monthlyDeliveryRevenue;
    const foodMaterialCost = monthlyRevenue * assumption.foodCostRatio;
    const paymentFees = monthlyRevenue * (assumption.paymentFeeRatio ?? 0);
    const deliveryPlatformFees = monthlyDeliveryRevenue * assumption.deliveryFeeRatio;
    const deliveryVariableCost = monthlyDeliveryOrders * (assumption.deliveryVariableCostPerOrder ?? 0);
    const royaltyCost = monthlyRevenue * assumption.royaltyRatio;
    const deliveryFees = deliveryPlatformFees + deliveryVariableCost;
    const otherVariableCosts = paymentFees + royaltyCost;
    const variableCost = foodMaterialCost + deliveryFees + otherVariableCosts;
    const labor = assumption.labor;
    const laborBasis = labor?.mode ?? "fixed-monthly";
    const laborResources = labor?.mode === "operation-linked" ? {
      cooks: first.snapshot.input.operation.resources.cooks,
      servers: first.snapshot.input.operation.resources.servers,
      cashiers: first.snapshot.input.operation.resources.cashiers,
      otherStaff: labor.otherStaffCount,
    } : null;
    const laborCost = labor?.mode === "operation-linked" && laborResources
      ? laborResources.cooks * labor.monthlyCostPerCook + laborResources.servers * labor.monthlyCostPerServer
        + laborResources.cashiers * labor.monthlyCostPerCashier + laborResources.otherStaff * labor.monthlyCostPerOtherStaff
      : assumption.monthlyLabor;
    const otherFixedCosts = assumption.monthlyUtilities + assumption.monthlyMarketing + assumption.monthlyOtherFixed
      + (assumption.monthlyMaintenance ?? 0) + (assumption.monthlyInsurance ?? 0);
    const fixedCost = laborCost + assumption.monthlyRent + otherFixedCosts;
    const contribution = monthlyRevenue - variableCost;
    const operatingProfit = contribution - fixedCost;
    const operatingMargin = monthlyRevenue > 0 ? operatingProfit / monthlyRevenue : null;
    const contributionMargin = monthlyRevenue > 0 ? contribution / monthlyRevenue : null;
    const breakEvenReason = monthlyRevenue <= 0 ? "No positive revenue basis is available to establish a contribution margin."
      : contribution <= 0 ? "Contribution is nonpositive at the assumed prices, variable costs and observed channel mix." : null;
    const scaleToBreakEven = breakEvenReason === null ? fixedCost / contribution : null;
    const breakEvenRevenue = scaleToBreakEven === null ? null : monthlyRevenue * scaleToBreakEven;
    const monthlyActivities = monthlyDineInCustomers + monthlyDeliveryOrders;
    const breakEvenCustomersOrOrders = scaleToBreakEven === null ? null : monthlyActivities * scaleToBreakEven;
    const breakEvenDailyDineInCustomers = scaleToBreakEven === null ? null : monthlyDineInCustomers * scaleToBreakEven / assumption.operatingDaysPerMonth;
    const breakEvenDailyDeliveryOrders = scaleToBreakEven === null ? null : monthlyDeliveryOrders * scaleToBreakEven / assumption.operatingDaysPerMonth;
    const breakEvenDailyCustomersOrOrders = breakEvenCustomersOrOrders === null ? null : breakEvenCustomersOrOrders / assumption.operatingDaysPerMonth;
    const observedDailyDineInCustomers = monthlyDineInCustomers / assumption.operatingDaysPerMonth;
    const observedDailyDeliveryOrders = monthlyDeliveryOrders / assumption.operatingDaysPerMonth;
    const observedDailyCustomersOrOrders = observedDailyDineInCustomers + observedDailyDeliveryOrders;
    const nonRefundableInvestment = assumption.initialCapex + assumption.initialFranchiseFee + assumption.initialInteriorCost
      + (assumption.initialEquipmentCost ?? 0) + (assumption.initialOtherInvestment ?? 0);
    const refundableDeposit = assumption.refundableDeposit ?? 0;
    const estimatedPaybackMonths = operatingProfit > 0 ? nonRefundableInvestment / operatingProfit : null;
    const result: FinancialAnalysisResult = {
      id: `financial:${first.id}:${assumption.id}:${assumption.revision}`,
      engine: { ...this.descriptor }, input: structuredClone(input), inputContentKey, currency: assumption.currency,
      status: "conditional-estimate", monthlyDineInRevenue, monthlyDeliveryRevenue, monthlyRevenue,
      monthlyDineInCustomers, monthlyDeliveryOrders,
      costOfGoodsSold: foodMaterialCost, foodMaterialCost, paymentFees, deliveryPlatformFees,
      deliveryVariableCost, deliveryFees, royaltyCost, otherVariableCosts,
      laborCost, rent: assumption.monthlyRent, otherFixedCosts, fixedCost, variableCost,
      operatingProfit, monthlyOperatingProfit: operatingProfit, operatingMargin, contribution, contributionMargin,
      breakEvenRevenue,
      // The legacy customer count is monthly and meaningful only for a dine-in-only mix.
      breakEvenCustomers: monthlyDeliveryOrders > 0 ? null : breakEvenCustomersOrOrders,
      breakEvenCustomersOrOrders, breakEvenDailyCustomersOrOrders,
      breakEvenDailyDineInCustomers, breakEvenDailyDeliveryOrders,
      observedDailyDineInCustomers, observedDailyDeliveryOrders, observedDailyCustomersOrOrders,
      observedThroughputMarginPerDay: breakEvenDailyCustomersOrOrders === null ? null : observedDailyCustomersOrOrders - breakEvenDailyCustomersOrOrders,
      capacityComparisonBasis: "observed-throughput-at-constant-channel-mix-not-maximum-capacity",
      initialInvestment: nonRefundableInvestment + refundableDeposit, nonRefundableInvestment, refundableDeposit,
      operatingCashContribution: operatingProfit, paybackInvestmentBasis: "non-refundable-investment-excluding-deposit",
      estimatedPaybackMonths,
      nullReasons: {
        operatingMargin: monthlyRevenue > 0 ? null : "Monthly revenue is zero.",
        contributionMargin: monthlyRevenue > 0 ? null : "Monthly revenue is zero.",
        breakEven: breakEvenReason,
        breakEvenCustomers: monthlyDeliveryOrders > 0 ? "Dine-in customers and delivery orders are distinct units; use the separate channel break-even counts at constant mix." : breakEvenReason,
        estimatedPaybackMonths: operatingProfit > 0 ? null : "Operating cash contribution is nonpositive; a finite positive payback period cannot be estimated.",
      },
      conditions: {
        projectRef: structuredClone(first.snapshot.projectRef), scenarioRef: structuredClone(first.snapshot.scenarioRef),
        dineInRevenueUnit: "currency/customer", deliveryRevenueUnit: "currency/order",
        averageSpendingPerCustomer, averageDeliveryOrderValue,
        spendingSource: assumption.averageSpendingPerCustomer === undefined ? "operation-policy" : "financial-assumption",
        operatingDaysPerMonth: assumption.operatingDaysPerMonth, dayEstimates,
        replicationCount: runs.length, replicationAggregation: "mean-within-day-type-then-operating-day-weighted",
        runInputContentKeys: runs.map(run => ({ runId: run.id, contentKey: run.snapshot.contentKey })),
        laborBasis, laborResources,
      },
      assumptions: [
        ...structuredClone(assumption.assumptions),
        { id: "financial-conditional-estimate", description: "Conditional scenario arithmetic from completed simulations and explicit assumptions, not a forecast or an investment decision.", value: true, unit: "interpretation", source: this.descriptor.id },
        { id: "financial-scaling", description: "Replicas are averaged within day type. User-specified run-to-day multipliers extrapolate the observed horizon; day weights then form a representative month, not a calendar forecast.", value: canonicalJson(mix), unit: "operating-day-mix", source: "financial-assumption" },
        { id: "financial-channel-mix", description: "Break-even scales completed dine-in customers and delivery orders together at the observed channel mix; observed throughput is not guaranteed maximum capacity.", value: true, unit: "interpretation", source: this.descriptor.id },
        { id: "financial-cash-scope", description: "Operating cash contribution equals modeled operating profit. Taxes, financing, depreciation, working capital changes and future replacement CAPEX are excluded. Refundable deposit is excluded from simple payback but included in initial cash investment.", value: true, unit: "scope", source: this.descriptor.id },
        { id: "financial-cost-basis", description: "All investment lines are additive and must not overlap. Payment fees apply to both channels; platform fees apply only to delivery revenue; per-order delivery expense is additional. Labor is monthly and is not multiplied by operating days.", value: true, unit: "cost-scope", source: this.descriptor.id },
      ],
    };
    // Catch overflow in every derived number, including nested/null-safe ratios.
    canonicalJson(result);
    return result;
  }
}
