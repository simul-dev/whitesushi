import { canonicalJson, DomainValidationError, siteContentKey, validateMarket } from "../../core";
import type { DayType, MarketProvider, ModuleVersion, NearbyBusiness } from "../../core";
import type { AdministrativeArea, MarketIntelligenceProfile, MarketRequest } from "./types";
import { validateMarketRequest } from "./validation";

export const MOCK_MARKET_PROVIDER_VERSION: Readonly<ModuleVersion> = Object.freeze({
  id: "mock-market", version: "1.0.0",
});

export interface MockMarketProviderOptions {
  /** Illustrative catchment only. Changing radius filters businesses, not population estimates. */
  radiusMeters?: number;
  administrativeArea?: AdministrativeArea | null;
  /** Exact category match identifies fictional competitors. */
  category?: string;
}

// Deliberately fixed synthetic patterns, independent of geography or the requested date range.
const HOURLY_TRAFFIC = [30, 20, 12, 10, 15, 35, 95, 210, 360, 300, 340, 640, 840, 670, 440, 410, 510, 690, 790, 710, 470, 280, 140, 65];
const DAY_FACTORS: readonly { dayType: DayType; factor: number }[] = [
  { dayType: "weekday", factor: 1 }, { dayType: "weekend", factor: 1.15 }, { dayType: "holiday", factor: 1.1 },
];
const FICTIONAL_BUSINESSES: Omit<NearbyBusiness, "competitor">[] = [
  { id: "demo-business-1", name: "Demo Korean Restaurant A", category: "korean-restaurant", distanceMeters: 90 },
  { id: "demo-business-2", name: "Demo Cafe B", category: "cafe", distanceMeters: 150 },
  { id: "demo-business-3", name: "Demo Korean Restaurant C", category: "korean-restaurant", distanceMeters: 260 },
  { id: "demo-business-4", name: "Demo Grocery D", category: "grocery", distanceMeters: 420 },
];

/** Network-free fixture provider. It makes no geographic or future-demand claims. */
export class MockMarketProvider implements MarketProvider {
  readonly descriptor = MOCK_MARKET_PROVIDER_VERSION;
  private readonly options: Required<MockMarketProviderOptions>;

  constructor(options: MockMarketProviderOptions = {}) {
    this.options = structuredClone({
      radiusMeters: options.radiusMeters ?? 500,
      administrativeArea: options.administrativeArea ?? null,
      category: options.category ?? "korean-restaurant",
    });
    canonicalJson(this.options);
    if (!Number.isFinite(this.options.radiusMeters) || this.options.radiusMeters <= 0) {
      throw new DomainValidationError("market.radiusMeters", "must be positive and finite");
    }
    if (typeof this.options.category !== "string" || !this.options.category.trim()) {
      throw new DomainValidationError("market.category", "must be a non-empty category identifier");
    }
    const area = this.options.administrativeArea;
    if (area !== null && [area.name, area.level, ...(area.code === null ? [] : [area.code])].some((value) => typeof value !== "string" || !value.trim())) {
      throw new DomainValidationError("market.administrativeArea", "name, level and any supplied code must be non-empty");
    }
  }

  async fetch(input: MarketRequest): Promise<MarketIntelligenceProfile> {
    validateMarketRequest(input);
    const request = structuredClone(input);
    const options = structuredClone(this.options);
    const missingFields = ["residentPopulation", "observedPopulation", "observedFootTraffic"];
    if (request.site.address === null) missingFields.push("address");
    if (request.site.coordinates === null) missingFields.push("coordinates");
    if (options.administrativeArea === null) missingFields.push("administrativeArea");
    const profile: MarketIntelligenceProfile = {
      // Retain exact identity inputs rather than a collision-prone short hash or current clock.
      id: `mock-market:${canonicalJson({ request, options })}`,
      revision: 1,
      siteRef: { id: request.site.id, revision: request.site.revision },
      siteContentKey: siteContentKey(request.site),
      provider: { ...this.descriptor },
      provenance: { kind: "demo", source: "Synthetic market fixture; no observed or live market data" },
      period: request.period,
      buckets: DAY_FACTORS.flatMap(({ dayType, factor }) => HOURLY_TRAFFIC.map((traffic, hour) => ({
        dayType, hour,
        population: Math.round((1200 + traffic * 1.8) * factor),
        footTrafficPersons: Math.round(traffic * factor),
      }))),
      nearbyBusinesses: FICTIONAL_BUSINESSES.filter((business) => business.distanceMeters <= options.radiusMeters)
        .map((business) => ({ ...business, competitor: business.category === options.category })),
      location: {
        name: request.site.name, address: request.site.address, coordinates: request.site.coordinates,
        administrativeArea: options.administrativeArea,
        administrativeAreaSource: options.administrativeArea === null ? "unavailable" : "user-supplied",
      },
      coverage: {
        spatial: { kind: "radius", radiusMeters: options.radiusMeters, basis: "illustrative" },
        temporal: { bucketMinutes: 60, timeZone: request.site.timeZone, aggregation: "synthetic-typical-day" },
        category: options.category,
        residentPopulation: null,
        populationMeaning: "illustrative-living-population-stock",
        footTrafficMeaning: "illustrative-person-passages-per-hour",
      },
      dataQuality: {
        kind: "synthetic", confidence: null, missingFields,
        limitations: [
          "All population, traffic, business names and distances are fictional, uncalibrated demo values.",
          "The period labels the requested scenario; it is not an actual observation period or forecast.",
          "Patterns are identical for every location and period; radius only filters fictional businesses.",
          "Population is an hourly stock and must not be summed into unique daily residents; passages can count repeat people.",
          "Weekday, weekend and holiday profiles are illustrative typical days; there is no calendar, seasonality or geocoding.",
        ],
      },
      assumptions: [
        { id: "market-demo", description: "Every market value is a deterministic synthetic example, not an observation or forecast.", value: true, unit: "boolean", source: this.descriptor.id },
        { id: "market-spatial-resolution", description: "Illustrative radius; changing radius only filters fictional businesses and does not rescale the fixed population or traffic fixture.", value: options.radiusMeters, unit: "meters", source: this.descriptor.id },
        { id: "market-time-resolution", description: "One local-time hour in a synthetic typical day. The requested period is a scenario label, not evidence of observations.", value: { minutes: 60, timeZone: request.site.timeZone, period: request.period }, unit: "minutes", source: this.descriptor.id },
        { id: "market-population-basis", description: "Population is an illustrative living-population stock, not residents or arrivals; traffic is hourly person-passages and may include repeats.", value: "synthetic stock and passages", unit: "persons", source: this.descriptor.id },
        { id: "market-day-factors", description: "Synthetic weekday/weekend/holiday scaling factors, with no public holiday calendar lookup.", value: { weekday: 1, weekend: 1.15, holiday: 1.1 }, unit: "multiplier", source: this.descriptor.id },
        { id: "market-competitor-category", description: "Fictional competitors are exact category matches; no real business census or competitive inference is performed.", value: options.category, unit: "category identifier", source: this.descriptor.id },
        { id: "market-quality", description: "No empirical confidence is available for synthetic data; missing observations are not treated as measured zero.", value: { kind: "synthetic", confidence: null, missingFields }, unit: "classification", source: this.descriptor.id },
      ],
    };
    validateMarket(profile);
    return profile;
  }
}
