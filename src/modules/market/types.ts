import type { DomainIssue, MarketProfile, Site } from "../../core";

export type MarketRequest = { site: Site; period: MarketProfile["period"] };

/** Supplied explicitly; this module never infers an administrative area from an address. */
export interface AdministrativeArea {
  name: string;
  code: string | null;
  level: string;
}

/** Extra descriptive metadata; usable wherever the existing MarketProfile port is accepted. */
export interface MarketIntelligenceProfile extends MarketProfile {
  location: {
    name: string;
    address: string | null;
    coordinates: Site["coordinates"];
    administrativeArea: AdministrativeArea | null;
    administrativeAreaSource: "user-supplied" | "unavailable";
  };
  coverage: {
    spatial: { kind: "radius"; radiusMeters: number; basis: "illustrative" };
    temporal: { bucketMinutes: 60; timeZone: string; aggregation: "synthetic-typical-day" };
    category: string;
    residentPopulation: number | null;
    populationMeaning: "illustrative-living-population-stock";
    footTrafficMeaning: "illustrative-person-passages-per-hour";
  };
  dataQuality: {
    kind: "synthetic";
    confidence: null;
    missingFields: string[];
    limitations: string[];
  };
}

export type MarketFetchResult<T extends MarketProfile = MarketProfile> =
  | { status: "available"; profile: T; issues: DomainIssue[] }
  | { status: "unavailable"; profile: null; issues: DomainIssue[] };
