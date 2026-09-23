import { canonicalJson, DomainValidationError, validateSite } from "../../core";
import type { MarketRequest } from "./types";

export function validateMarketRequest(input: MarketRequest): void {
  canonicalJson(input);
  validateSite(input.site);
  for (const key of ["from", "to"] as const) {
    const timestamp = input.period[key];
    if (typeof timestamp !== "string" || !/^\d{4}-\d\d-\d\dT/.test(timestamp) || !Number.isFinite(Date.parse(timestamp))) {
      throw new DomainValidationError(`market.period.${key}`, "must be an ISO timestamp");
    }
  }
  if (Date.parse(input.period.to) <= Date.parse(input.period.from)) {
    throw new DomainValidationError("market.period", "end must follow start");
  }
}
