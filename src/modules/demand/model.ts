import {
  canonicalJson, demandParametersContentKey, DomainValidationError, marketContentKey,
  validateDemand, validateDemandParameters, validateMarket,
} from "../../core";
import type {
  ArtifactRef, Assumption, DemandBucket, DemandModel, DemandParameters, DemandProfile,
  JsonValue, MarketProfile,
} from "../../core";
import { DEMAND_PARAMETER_DEFINITIONS } from "./parameters";

export interface ExplainedDemandBucket extends DemandBucket {
  timeBucket: { startMinute: number; endMinute: number; durationHours: 1 };
  /** All counts describe one representative hour, not totals across the observation period. */
  potentialTraffic: number;
  categoryDemand: number;
  selectedStoreDemand: number;
  conversionRate: number;
  multipliers: { day: number; meal: number; weatherEvent: number; hourly: number; combined: number };
  expectedAllChannelCustomersPerHour: number;
  expectedDeliveryCustomersPerHour: number;
}

export interface ExplainedDemandProfile extends DemandProfile {
  buckets: ExplainedDemandBucket[];
}

export interface TransparentDemandModelOptions {
  /** Callers managing revisions can assign a new profile reference for each recalculation. */
  profileRef?: ArtifactRef;
  distribution?: DemandBucket["distribution"];
}

const source = "transparent-demand@1.0.0";
const assumption = (id: string, description: string, value: JsonValue, unit: string): Assumption => ({
  id: `demand.${id}`, description, value, unit, source,
});
const finite = (value: number, path: string) => {
  if (!Number.isFinite(value)) throw new DomainValidationError(path, "calculation overflow; reduce traffic or multipliers");
  return value;
};

/** Transparent conditional scenario calculation. This model does not forecast future foot traffic. */
export class TransparentDemandModel implements DemandModel {
  readonly descriptor = Object.freeze({ id: "transparent-demand", version: "1.0.0" });
  private readonly options: TransparentDemandModelOptions;

  constructor(options: TransparentDemandModelOptions = {}) {
    this.options = structuredClone(options);
    if (options.distribution !== undefined && !["poisson", "deterministic"].includes(options.distribution))
      throw new DomainValidationError("demand.distribution", "unsupported distribution");
    if (options.profileRef && (!options.profileRef.id.trim() || !Number.isSafeInteger(options.profileRef.revision) || options.profileRef.revision < 1))
      throw new DomainValidationError("demand.profileRef", "requires a non-empty id and positive integer revision");
  }

  calculate({ market, parameters }: { market: MarketProfile; parameters: DemandParameters }): ExplainedDemandProfile {
    validateMarket(market);
    validateDemandParameters(parameters);
    if (!market.buckets.length) throw new DomainValidationError("market.buckets", "at least one observed or explicitly demo traffic bucket is required");
    const distribution = this.options.distribution ?? "poisson";
    const buckets = market.buckets.map((bucket): ExplainedDemandBucket => {
      const path = `market.buckets.${bucket.dayType}.${bucket.hour}`;
      if (bucket.footTrafficPersons === null)
        throw new DomainValidationError(`${path}.footTrafficPersons`, "traffic is unavailable; population is not a substitute and missing traffic is not zero demand");
      const potentialTraffic = bucket.footTrafficPersons;
      const categoryDemand = potentialTraffic * parameters.categoryParticipationRate;
      const selectedStoreDemand = categoryDemand * parameters.brandShare;
      const day = bucket.dayType === "weekday" ? parameters.weekdayMultiplier : parameters.weekendMultiplier;
      const meal = bucket.hour >= 11 && bucket.hour < 14 ? parameters.lunchMultiplier
        : bucket.hour >= 17 && bucket.hour < 21 ? parameters.dinnerMultiplier : 1;
      const weatherEvent = parameters.weatherEventMultiplier;
      const hourly = parameters.hourlyMultipliers?.find((item) => item.dayType === bucket.dayType && item.hour === bucket.hour)?.multiplier ?? 1;
      const combined = finite(day * meal * weatherEvent * hourly, `${path}.combinedMultiplier`);
      const expectedAllChannelCustomersPerHour = finite(selectedStoreDemand * parameters.visitConversionRate * combined, `${path}.expectedCustomersPerHour`);
      const expectedDeliveryCustomersPerHour = expectedAllChannelCustomersPerHour * parameters.deliveryRatio;
      const expectedCustomersPerHour = expectedAllChannelCustomersPerHour * (1 - parameters.deliveryRatio);
      return {
        dayType: bucket.dayType, hour: bucket.hour,
        timeBucket: { startMinute: bucket.hour * 60, endMinute: (bucket.hour + 1) * 60, durationHours: 1 },
        potentialTraffic, categoryDemand, selectedStoreDemand, conversionRate: parameters.visitConversionRate,
        multipliers: { day, meal, weatherEvent, hourly, combined },
        expectedAllChannelCustomersPerHour, expectedDeliveryCustomersPerHour, expectedCustomersPerHour, distribution,
      };
    });
    const parameterAssumptions = Object.entries(DEMAND_PARAMETER_DEFINITIONS).map(([key, definition]) => {
      const value = parameters[key as keyof DemandParameters] ?? [];
      return assumption(`parameter.${key}`, definition.description, JSON.parse(canonicalJson(value)) as JsonValue, definition.unit);
    });
    const profile: ExplainedDemandProfile = {
      ...(this.options.profileRef ?? { id: `${market.id}:demand`, revision: market.revision }),
      model: { ...this.descriptor },
      provenance: {
        kind: market.provenance.kind === "demo" ? "demo" : "derived",
        source: `${source}; conditional scenario from ${market.provider.id}@${market.provider.version}; ${market.provenance.source}`,
      },
      lineage: {
        marketRef: { id: market.id, revision: market.revision },
        marketContentKey: marketContentKey(market),
        parametersContentKey: demandParametersContentKey(parameters),
      },
      buckets,
      assumptions: [
        assumption("interpretation", "Conditional scenario expectations, not a guaranteed future forecast or measured customer count. Defaults need local calibration.", "scenario-not-forecast", "interpretation"),
        assumption("formula", "One-hour traffic is converted to customer demand before allocating delivery and dine-in channels.", "footTrafficPersons * categoryParticipationRate * brandShare * visitConversionRate * dayMultiplier * mealMultiplier * weatherEventMultiplier * hourlyMultiplier; dineIn = total * (1 - deliveryRatio)", "customers/hour"),
        assumption("trafficBasis", "Use only hourly passers-by; resident/living population is not added, substituted, or assumed to be store customers. Missing traffic fails explicitly.", "footTrafficPersons", "persons/hour"),
        assumption("timeBuckets", "Each source bucket is a representative local one-hour interval; observation-period duration does not scale arrivals. Only supplied hours are returned; missing hours are not inferred as zero.", "[hour:00, next-hour:00)", "local hour"),
        assumption("mealWindows", "Lunch and dinner windows are half-open and do not overlap.", { lunchStartHour: 11, lunchEndHour: 14, dinnerStartHour: 17, dinnerEndHour: 21 }, "local hour"),
        assumption("holidayRule", "Holiday buckets use the weekend multiplier unless an explicit hourly multiplier further adjusts them.", "weekendMultiplier", "rule"),
        assumption("multipliers", "Scenario adjustments multiply observed patterns; neutral defaults avoid adding another day/meal pattern automatically. Large multipliers may exceed traffic counts and are not unique-person probabilities.", "multiplicative; no clipping", "rule"),
        assumption("channels", "Delivery is an assumed split of converted customer demand, not a separately observed delivery market. Only dine-in customers enter the restaurant DES; delivery kitchen load and delivery fees are not simulated.", { arrivalChannel: "dine-in", excludedChannel: "delivery", deliveryRatio: parameters.deliveryRatio }, "channel allocation"),
        assumption("arrivalDistribution", "Hourly rates describe individual customers, not parties. Poisson means an independent piecewise-constant customer intensity; deterministic is a scenario alternative. The simulation owns actual arrival sampling and party formation.", distribution, "distribution"),
        assumption("marketSource", "Preserve exact source classification, period and upstream assumptions without claiming observed customer arrivals.", JSON.parse(canonicalJson({ provider: market.provider, provenance: market.provenance, period: market.period, assumptions: market.assumptions })) as JsonValue, "provenance"),
        ...parameterAssumptions,
      ],
    };
    validateDemand(profile);
    canonicalJson(profile);
    return profile;
  }
}
