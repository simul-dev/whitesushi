import { afterEach, describe, expect, it, vi } from "vitest";
import { canonicalJson, siteContentKey, validateMarket } from "../../core";
import type { MarketProfile, MarketProvider, Site } from "../../core";
import { fetchMarketProfile, MockMarketProvider } from "./index";
import type { MarketRequest } from "./index";

const request = (): MarketRequest => ({
  site: {
    id: "candidate-site", revision: 2, name: "Candidate Restaurant",
    address: "User supplied sample address", coordinates: { latitude: 37.55, longitude: 126.98 },
    timeZone: "Asia/Seoul",
  },
  period: { from: "2026-09-01T00:00:00+09:00", to: "2026-09-08T00:00:00+09:00" },
});

const providerWith = (fetch: MarketProvider["fetch"]): MarketProvider => ({
  descriptor: { id: "test-public-data", version: "1.0.0" }, fetch,
});

async function observedProfile(input: MarketRequest = request()): Promise<MarketProfile> {
  const profile = await new MockMarketProvider().fetch(input);
  // Build a contract-only fixture for provider validation, not a claimed real data source.
  return {
    id: "contract-fixture", revision: 1, siteRef: profile.siteRef, siteContentKey: profile.siteContentKey,
    provider: { id: "test-public-data", version: "1.0.0" },
    provenance: { kind: "observed", source: "Unit test fixture; not live data" },
    period: profile.period, buckets: profile.buckets,
    nearbyBusinesses: profile.nearbyBusinesses, assumptions: [],
  };
}

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe("MockMarketProvider", () => {
  it("implements the existing port and labels all values and quality as uncalibrated demo", async () => {
    const provider: MarketProvider = new MockMarketProvider();
    const profile = await provider.fetch(request());
    expect(() => validateMarket(profile)).not.toThrow();
    expect(profile.provenance.kind).toBe("demo");
    expect(profile.provenance.observedAt).toBeUndefined();
    expect(profile.siteContentKey).toBe(siteContentKey(request().site));
    expect(profile.assumptions.find((a) => a.id === "market-demo")?.value).toBe(true);
    expect(profile.assumptions.find((a) => a.id === "market-quality")?.value).toMatchObject({ confidence: null });
  });

  it("returns repeatable profiles without relying on the clock, network or random state", async () => {
    const provider = new MockMarketProvider();
    const first = await provider.fetch(request());
    vi.spyOn(Date, "now").mockImplementation(() => { throw new Error("clock dependency"); });
    vi.spyOn(Math, "random").mockImplementation(() => { throw new Error("random dependency"); });
    expect(canonicalJson(await provider.fetch(request()))).toBe(canonicalJson(first));
    expect(canonicalJson(await new MockMarketProvider().fetch(request()))).toBe(canonicalJson(first));
  });

  it("provides complete local-hour profiles with distinct population stock and foot traffic", async () => {
    const profile = await new MockMarketProvider().fetch(request());
    for (const dayType of ["weekday", "weekend", "holiday"] as const) {
      const buckets = profile.buckets.filter((b) => b.dayType === dayType);
      expect(buckets.map((b) => b.hour)).toEqual(Array.from({ length: 24 }, (_, i) => i));
      expect(buckets.every((b) => b.population! > b.footTrafficPersons! && b.footTrafficPersons! > 0)).toBe(true);
    }
    const atNoon = (dayType: string) => profile.buckets.find((b) => b.dayType === dayType && b.hour === 12)!.footTrafficPersons!;
    expect(atNoon("weekend")).toBeGreaterThan(atNoon("weekday"));
    expect(profile.coverage.temporal).toEqual({ bucketMinutes: 60, timeZone: "Asia/Seoul", aggregation: "synthetic-typical-day" });
    expect(profile.coverage.residentPopulation).toBeNull();
    expect(profile.dataQuality.kind).toBe("synthetic");
  });

  it("preserves supplied location/admin area and filters fictional category competitors within the radius", async () => {
    const area = { name: "User supplied district", level: "district", code: "USER-01" };
    const provider = new MockMarketProvider({ administrativeArea: area, category: "cafe", radiusMeters: 200 });
    area.name = "Mutated after construction";
    const input = request();
    const original = structuredClone(input);
    const profile = await provider.fetch(input);
    expect(input).toEqual(original);
    expect(profile.location).toMatchObject({ address: input.site.address, coordinates: input.site.coordinates, administrativeAreaSource: "user-supplied" });
    expect(profile.location.administrativeArea?.name).toBe("User supplied district");
    expect(profile.nearbyBusinesses).toHaveLength(2);
    expect(profile.nearbyBusinesses.filter((b) => b.competitor).map((b) => b.category)).toEqual(["cafe"]);
    expect(profile.nearbyBusinesses.every((b) => b.distanceMeters <= 200)).toBe(true);
    profile.location.coordinates!.latitude = 0;
    profile.nearbyBusinesses[0].name = "changed";
    expect(input).toEqual(original);
    expect((await provider.fetch(input)).nearbyBusinesses[0].name).toContain("Demo");
    expect((await provider.fetch(input)).location.coordinates).toEqual(original.site.coordinates);
  });

  it("leaves unknown location fields and resident population null instead of inventing geographic facts", async () => {
    const input = request();
    input.site.address = null;
    input.site.coordinates = null;
    const profile = await new MockMarketProvider().fetch(input);
    expect(profile.location.administrativeArea).toBeNull();
    expect(profile.location.coordinates).toBeNull();
    expect(profile.location.address).toBeNull();
    expect(profile.dataQuality.missingFields).toEqual(expect.arrayContaining(["coordinates", "address", "administrativeArea", "residentPopulation"]));
  });

  it("does not imply that requesting another place, date or radius measures new population", async () => {
    const first = await new MockMarketProvider().fetch(request());
    const changed = request();
    changed.site.coordinates = { latitude: 35, longitude: 129 };
    changed.period.to = "2026-10-08T00:00:00+09:00";
    const second = await new MockMarketProvider({ radiusMeters: 100 }).fetch(changed);
    expect(first.buckets).toEqual(second.buckets);
    expect(first.id).not.toBe(second.id);
    expect(first.siteContentKey).not.toBe(second.siteContentKey);
    expect(second.dataQuality.limitations.some((limitation) => limitation.includes("identical for every location"))).toBe(true);
  });

  it.each([
    { radiusMeters: 0 }, { radiusMeters: Number.NaN }, { radiusMeters: -1 }, { category: " " },
    { administrativeArea: { name: "", level: "district", code: null } },
  ])("rejects invalid demo configuration %j", (options) => {
    expect(() => new MockMarketProvider(options)).toThrow();
  });

  it("rejects invalid sites, reversed or empty periods", async () => {
    const provider = new MockMarketProvider();
    const invalidSite = request();
    invalidSite.site.coordinates!.latitude = 91;
    await expect(provider.fetch(invalidSite)).rejects.toThrow();
    const empty = request();
    empty.period.to = empty.period.from;
    await expect(provider.fetch(empty)).rejects.toThrow("end must follow start");
    const reversed = request();
    reversed.period.from = "2027-01-01T00:00:00Z";
    await expect(provider.fetch(reversed)).rejects.toThrow("end must follow start");
  });
});

describe("fetchMarketProfile provider boundary", () => {
  it("returns the typed demo metadata through the safe boundary without changing the core port", async () => {
    const result = await fetchMarketProfile(new MockMarketProvider(), request());
    expect(result.status).toBe("available");
    if (result.status !== "available") throw new Error("Expected market");
    expect(result.profile.dataQuality.kind).toBe("synthetic");
    expect(result.issues).toEqual([]);
  });

  it("preserves an explicitly observed provider classification and isolates provider-owned output", async () => {
    const original = await observedProfile();
    const result = await fetchMarketProfile(providerWith(async () => original), request());
    expect(result.status).toBe("available");
    if (result.status !== "available") throw new Error("Expected market");
    expect(result.profile.provenance.kind).toBe("observed");
    result.profile.buckets[0].population = 0;
    expect(original.buckets[0].population).toBeGreaterThan(0);
  });

  it("contains both thrown and rejected errors without returning demo or leaking provider error contents", async () => {
    const failures: MarketProvider["fetch"][] = [
      () => { throw new Error("private token XYZ"); },
      async () => { throw new Error("private token XYZ"); },
    ];
    for (const fetch of failures) {
      const result = await fetchMarketProfile(providerWith(fetch), request());
      expect(result).toMatchObject({ status: "unavailable", profile: null, issues: [{ code: "market-provider-failed" }] });
      expect(canonicalJson(result)).not.toContain("XYZ");
    }
  });

  it("returns a timeout for a hung provider and safely handles a subsequent rejection", async () => {
    vi.useFakeTimers();
    let rejectAttempt: (error: Error) => void = () => { throw new Error("Provider not invoked"); };
    const provider = providerWith(() => new Promise((_resolve, reject) => { rejectAttempt = reject; }));
    const pending = fetchMarketProfile(provider, request(), { timeoutMs: 20 });
    await vi.advanceTimersByTimeAsync(20);
    expect(await pending).toMatchObject({ status: "unavailable", profile: null, issues: [{ code: "market-timeout" }] });
    expect(vi.getTimerCount()).toBe(0);
    rejectAttempt(new Error("Late network rejection"));
    await Promise.resolve();
  });

  it("clears the timeout after success", async () => {
    vi.useFakeTimers();
    await fetchMarketProfile(new MockMarketProvider(), request(), { timeoutMs: 100 });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("protects caller inputs even if a provider attempts to mutate them", async () => {
    const input = request();
    const original = structuredClone(input);
    const profile = await observedProfile();
    const provider = providerWith(async (providerInput) => {
      providerInput.site.coordinates!.latitude = 0;
      providerInput.period.from = "2020-01-01T00:00:00Z";
      return profile;
    });
    expect((await fetchMarketProfile(provider, input)).status).toBe("available");
    expect(input).toEqual(original);
  });

  it.each([
    ["site revision", "market-site-mismatch", (p: MarketProfile) => { p.siteRef.revision += 1; }],
    ["site content", "market-site-mismatch", (p: MarketProfile) => { p.siteContentKey = "old site content"; }],
    ["provider version", "market-provider-mismatch", (p: MarketProfile) => { p.provider.version = "2.0.0"; }],
    ["period", "market-period-mismatch", (p: MarketProfile) => { p.period.to = "2026-10-01T00:00:00Z"; }],
    ["negative population", "invalid-market-profile", (p: MarketProfile) => { p.buckets[0].population = -1; }],
    ["duplicate buckets", "invalid-market-profile", (p: MarketProfile) => { p.buckets.push({ ...p.buckets[0] }); }],
  ] as const)("rejects mismatched or invalid %s", async (_label, code, mutate) => {
    const profile = await observedProfile();
    mutate(profile);
    expect(await fetchMarketProfile(providerWith(async () => profile), request())).toMatchObject({
      status: "unavailable", profile: null, issues: [{ code }],
    });
  });

  it("contains malformed external data even when an adapter violates its TypeScript contract", async () => {
    const provider = providerWith(async () => ({ buckets: null }) as unknown as MarketProfile);
    expect(await fetchMarketProfile(provider, request())).toMatchObject({ status: "unavailable", issues: [{ code: "invalid-market-profile" }] });
  });

  it("reports missing values while preserving unknown null separately from observed zero", async () => {
    const profile = await observedProfile();
    profile.buckets = [
      { dayType: "weekday", hour: 11, population: null, footTrafficPersons: null },
      { dayType: "weekday", hour: 12, population: 0, footTrafficPersons: 0 },
    ];
    const result = await fetchMarketProfile(providerWith(async () => profile), request());
    expect(result.status).toBe("available");
    if (result.status !== "available") throw new Error("Expected partial data");
    expect(result.profile.buckets).toEqual(profile.buckets);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].code).toBe("missing-market-value");
  });

  it("reports an empty observation set instead of synthesizing zero buckets", async () => {
    const profile = await observedProfile();
    profile.buckets = [];
    const result = await fetchMarketProfile(providerWith(async () => profile), request());
    expect(result).toMatchObject({ status: "available", profile: { buckets: [] }, issues: [{ code: "empty-market-buckets" }] });
  });

  it("rejects invalid requests and timeout settings before invoking a provider", async () => {
    const fetch = vi.fn(async () => observedProfile());
    const invalid = request();
    invalid.site = { ...invalid.site, timeZone: "bad/time-zone" } as Site;
    expect(await fetchMarketProfile(providerWith(fetch), invalid)).toMatchObject({ status: "unavailable", issues: [{ code: "invalid-market-request" }] });
    for (const timeoutMs of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, 2_147_483_648]) {
      expect(await fetchMarketProfile(providerWith(fetch), request(), { timeoutMs })).toMatchObject({ status: "unavailable", issues: [{ code: "invalid-timeout" }] });
    }
    expect(fetch).not.toHaveBeenCalled();
  });
});
