import { validateDemandParameters } from "../../core";
import type { DemandParameters } from "../../core";

/** Illustrative scenario defaults, not calibrated estimates of a real store. */
export const DEMAND_PARAMETER_DEFINITIONS = {
  categoryParticipationRate: { defaultValue: 0.2, unit: "ratio", description: "Share of potential traffic participating in the restaurant category.", validRange: { min: 0, max: 1 } },
  brandShare: { defaultValue: 0.1, unit: "ratio", description: "Share of category demand selecting this store or brand.", validRange: { min: 0, max: 1 } },
  visitConversionRate: { defaultValue: 0.1, unit: "ratio", description: "Share of selected store demand converting to customers before channel allocation.", validRange: { min: 0, max: 1 } },
  weekdayMultiplier: { defaultValue: 1, unit: "multiplier", description: "Additional weekday scenario adjustment; neutral when the market already includes the day pattern.", validRange: { min: 0, max: Number.MAX_VALUE } },
  weekendMultiplier: { defaultValue: 1, unit: "multiplier", description: "Additional weekend and holiday scenario adjustment.", validRange: { min: 0, max: Number.MAX_VALUE } },
  lunchMultiplier: { defaultValue: 1, unit: "multiplier", description: "Adjustment during local hours 11:00 up to, but excluding, 14:00.", validRange: { min: 0, max: Number.MAX_VALUE } },
  dinnerMultiplier: { defaultValue: 1, unit: "multiplier", description: "Adjustment during local hours 17:00 up to, but excluding, 21:00.", validRange: { min: 0, max: Number.MAX_VALUE } },
  weatherEventMultiplier: { defaultValue: 1, unit: "multiplier", description: "User-assumed weather or event adjustment; no weather observations are fetched.", validRange: { min: 0, max: Number.MAX_VALUE } },
  deliveryRatio: { defaultValue: 0, unit: "ratio", description: "Share of converted customer demand allocated to delivery and excluded from the dine-in arrival stream.", validRange: { min: 0, max: 1 } },
  hourlyMultipliers: { defaultValue: [], unit: "multiplier per dayType/hour", description: "Optional unique local day-type/hour overrides; absent hours use 1.", validRange: { min: 0, max: 10 } },
} as const;

export function createDefaultDemandParameters(overrides: Partial<DemandParameters> = {}): DemandParameters {
  const parameters: DemandParameters = {
    categoryParticipationRate: DEMAND_PARAMETER_DEFINITIONS.categoryParticipationRate.defaultValue,
    brandShare: DEMAND_PARAMETER_DEFINITIONS.brandShare.defaultValue,
    visitConversionRate: DEMAND_PARAMETER_DEFINITIONS.visitConversionRate.defaultValue,
    weekdayMultiplier: 1,
    weekendMultiplier: 1,
    lunchMultiplier: 1,
    dinnerMultiplier: 1,
    weatherEventMultiplier: 1,
    deliveryRatio: 0,
    ...structuredClone(overrides),
  };
  validateDemandParameters(parameters);
  return parameters;
}
