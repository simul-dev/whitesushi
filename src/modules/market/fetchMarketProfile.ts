import { canonicalJson, siteContentKey, validateMarket } from "../../core";
import type { DomainIssue, MarketProfile, MarketProvider } from "../../core";
import type { MarketFetchResult, MarketRequest } from "./types";
import { validateMarketRequest } from "./validation";

type TypedProvider<T extends MarketProfile> = Omit<MarketProvider, "fetch"> & { fetch(input: MarketRequest): Promise<T> };
const unavailable = (code: string, path: string, message: string): MarketFetchResult<never> => ({
  status: "unavailable", profile: null, issues: [{ code, path, message }],
});

/**
 * Application boundary for any MarketProvider: failures are explicit, never substituted with demo data.
 * A timeout stops waiting but cannot cancel network I/O through the existing provider port.
 */
export async function fetchMarketProfile<T extends MarketProfile>(
  provider: TypedProvider<T>, input: MarketRequest, options: { timeoutMs?: number } = {},
): Promise<MarketFetchResult<T>> {
  const timeoutMs = options.timeoutMs ?? 10_000;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 2_147_483_647) {
    return unavailable("invalid-timeout", "market.timeoutMs", "Timeout must be a finite positive duration no greater than 2147483647 milliseconds");
  }
  let request: MarketRequest;
  let descriptor: MarketProvider["descriptor"];
  try {
    validateMarketRequest(input);
    request = structuredClone(input);
    descriptor = structuredClone(provider.descriptor);
    if (!descriptor.id?.trim() || !descriptor.version?.trim()) throw new Error("Invalid provider descriptor");
    canonicalJson(descriptor);
  } catch {
    return unavailable("invalid-market-request", "market.request", "A valid site, provider descriptor and non-empty ISO period are required");
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  // Rejection is handled even if the timeout has already won the race.
  const attempt = Promise.resolve().then(() => provider.fetch(structuredClone(request))).then(
    (profile) => ({ kind: "profile" as const, profile }),
    () => ({ kind: "failure" as const }),
  );
  try {
    const outcome = await Promise.race([
      attempt,
      new Promise<{ kind: "timeout" }>((resolve) => { timer = setTimeout(() => resolve({ kind: "timeout" }), timeoutMs); }),
    ]);
    if (outcome.kind === "timeout") return unavailable("market-timeout", "market.provider", "The market provider did not respond before the deadline");
    if (outcome.kind === "failure") return unavailable("market-provider-failed", "market.provider", "Market data is temporarily unavailable; retry or explicitly select another provider");
    try {
      canonicalJson(outcome.profile);
      const profile = structuredClone(outcome.profile);
      validateMarket(profile);
      if (profile.siteRef.id !== request.site.id || profile.siteRef.revision !== request.site.revision ||
          profile.siteContentKey !== siteContentKey(request.site)) {
        return unavailable("market-site-mismatch", "market.siteRef", "The returned market profile does not match the requested site revision and content");
      }
      if (canonicalJson(profile.provider) !== canonicalJson(descriptor)) {
        return unavailable("market-provider-mismatch", "market.provider", "The returned profile has a different provider identity or version");
      }
      if (Date.parse(profile.period.from) !== Date.parse(request.period.from) || Date.parse(profile.period.to) !== Date.parse(request.period.to)) {
        return unavailable("market-period-mismatch", "market.period", "The returned profile does not cover the requested period");
      }
      const issues: DomainIssue[] = [];
      if (!profile.buckets.length) issues.push({ code: "empty-market-buckets", path: "market.buckets", message: "The provider returned no population or traffic buckets; demand cannot be inferred from absent data" });
      profile.buckets.forEach((bucket, index) => {
        if (bucket.population === null || bucket.footTrafficPersons === null) issues.push({
          code: "missing-market-value", path: `market.buckets.${index}`,
          message: `Missing ${bucket.population === null ? "population" : ""}${bucket.population === null && bucket.footTrafficPersons === null ? " and " : ""}${bucket.footTrafficPersons === null ? "traffic" : ""} for ${bucket.dayType} hour ${bucket.hour}; null is not observed zero`,
        });
      });
      return { status: "available", profile, issues };
    } catch {
      return unavailable("invalid-market-profile", "market.profile", "The provider returned a malformed or invalid market profile");
    }
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
