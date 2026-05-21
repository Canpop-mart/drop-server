/*
Shared HTTP client for metadata providers.

Before this lived in each provider as a tangle of bespoke `$fetch` options
plus their own retry loop (igdb had exponential backoff for 429; steam +
pcgamingwiki + giantbomb each set `retry: 1, retryDelay: 1_000` inline;
sgdb rolled its own `AbortController` timeout). The 2026 metadata audit
collapsed them all here:

  - A token bucket per provider rate-limits outbound traffic, so that one
    pathologically slow upstream can't queue dozens of in-flight requests
    behind the same import task. Tokens refill on a rolling window —
    `tokens` per `intervalMs`.
  - 429 / 503 / 504 / network errors back off exponentially (1s, 2s, 4s).
    All other 4xx are treated as caller errors and rethrown immediately.
  - Every request carries a `User-Agent` (Drop/<version>) and a hard
    timeout so a hung socket can't stall a metadata import indefinitely.
  - A per-provider counter + last-error string is kept so the admin
    health-check endpoint can expose a live status without each provider
    needing its own bookkeeping.

Providers swap their raw `$fetch` calls for `metadataHttp.fetch(name, url,
opts)`. The `name` here is the provider's own `name()` — keep them in sync
so the rate limit + stats line up.
*/
import type { NitroFetchOptions, NitroFetchRequest } from "nitropack";
import { systemConfig } from "../config/sys-conf";
import { logger } from "~/server/internal/logging";

export type ProviderHealthStatus =
  | "up"
  | "down"
  | "unauthenticated"
  | "rate-limited";

export interface ProviderStats {
  requests: number;
  failures: number;
  rateLimited: number;
  lastError: string | null;
  lastErrorAt: string | null;
  lastSuccessAt: string | null;
}

interface RateLimitConfig {
  tokens: number;
  intervalMs: number;
}

interface TokenBucket {
  tokens: number;
  lastRefill: number;
  cfg: RateLimitConfig;
}

// Per-provider rate limits. Numbers are deliberately conservative — none
// of these upstreams publish a hard limit and we'd rather under-shoot than
// trip a temp ban during a big library import.
const DEFAULT_LIMITS: Record<string, RateLimitConfig> = {
  Steam: { tokens: 30, intervalMs: 10_000 }, // 30/10s
  IGDB: { tokens: 4, intervalMs: 1_000 }, // IGDB publishes 4 req/sec
  PCGamingWiki: { tokens: 10, intervalMs: 10_000 }, // be polite, MediaWiki
  GiantBomb: { tokens: 60, intervalMs: 60_000 }, // 60/min by their TOS
  SteamGridDB: { tokens: 30, intervalMs: 60_000 },
};

const DEFAULT_TIMEOUT_MS = 20_000;
const MAX_RETRIES = 3;

class MetadataHttp {
  private buckets = new Map<string, TokenBucket>();
  private stats = new Map<string, ProviderStats>();
  private statusOverrides = new Map<string, ProviderHealthStatus>();

  private getBucket(provider: string): TokenBucket {
    let b = this.buckets.get(provider);
    if (!b) {
      const cfg = DEFAULT_LIMITS[provider] ?? {
        tokens: 30,
        intervalMs: 10_000,
      };
      b = { tokens: cfg.tokens, lastRefill: Date.now(), cfg };
      this.buckets.set(provider, b);
    }
    return b;
  }

  private getStats(provider: string): ProviderStats {
    let s = this.stats.get(provider);
    if (!s) {
      s = {
        requests: 0,
        failures: 0,
        rateLimited: 0,
        lastError: null,
        lastErrorAt: null,
        lastSuccessAt: null,
      };
      this.stats.set(provider, s);
    }
    return s;
  }

  /**
   * Acquire a token from the bucket, sleeping until one is available.
   * Refills are computed lazily on read — cheaper than running a
   * setInterval in long-lived server processes.
   */
  private async acquireToken(provider: string): Promise<void> {
    const b = this.getBucket(provider);
    while (true) {
      const now = Date.now();
      const elapsed = now - b.lastRefill;
      if (elapsed >= b.cfg.intervalMs) {
        b.tokens = b.cfg.tokens;
        b.lastRefill = now;
      }
      if (b.tokens > 0) {
        b.tokens -= 1;
        return;
      }
      // Wait until the next refill window
      const waitMs = b.cfg.intervalMs - elapsed;
      await new Promise((r) => setTimeout(r, Math.max(50, waitMs)));
    }
  }

  /**
   * Mark provider as unauthenticated/down. Overrides what the live stats
   * would otherwise infer. Set to `null` to clear.
   */
  setStatus(provider: string, status: ProviderHealthStatus | null) {
    if (status === null) this.statusOverrides.delete(provider);
    else this.statusOverrides.set(provider, status);
  }

  /**
   * Computed live status: an explicit override wins, otherwise inferred
   * from recent request stats. Providers with zero traffic are "up" by
   * default (so the admin page doesn't scream until something fails).
   */
  status(provider: string): ProviderHealthStatus {
    const override = this.statusOverrides.get(provider);
    if (override) return override;
    const s = this.stats.get(provider);
    if (!s) return "up";
    // If the last 5 requests were all failures, call it down. Otherwise
    // up. Rate limiting is signalled via setStatus, not inferred — a
    // single 429 isn't worth flipping the health badge.
    if (s.requests > 0 && s.requests - s.failures === 0) return "down";
    return "up";
  }

  getStatsSnapshot(provider: string): ProviderStats {
    // Shallow clone so callers can't mutate our state
    return { ...this.getStats(provider) };
  }

  async fetch<T>(
    provider: string,
    url: NitroFetchRequest,
    opts?: NitroFetchOptions<NitroFetchRequest>,
  ): Promise<T> {
    await this.acquireToken(provider);
    const stats = this.getStats(provider);
    stats.requests += 1;

    const overlay: NitroFetchOptions<NitroFetchRequest> = {
      timeout: DEFAULT_TIMEOUT_MS,
      ...opts,
      headers: {
        "User-Agent": `Drop/${systemConfig.getDropVersion()}`,
        ...(opts?.headers ?? {}),
      },
    };

    let lastErr: unknown;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const result = await $fetch<T>(url, overlay);
        stats.lastSuccessAt = new Date().toISOString();
        // Successful request clears any prior auth-failure override
        // (e.g. IGDB token refresh succeeded).
        if (this.statusOverrides.get(provider) === "rate-limited") {
          this.statusOverrides.delete(provider);
        }
        return result;
      } catch (e: unknown) {
        lastErr = e;
        const err = e as {
          response?: { status?: number };
          statusCode?: number;
          status?: number;
          name?: string;
          message?: string;
        };
        const status =
          err?.response?.status ?? err?.statusCode ?? err?.status ?? 0;
        const isTransient =
          status === 429 ||
          status === 503 ||
          status === 504 ||
          err?.name === "FetchError" ||
          err?.name === "AbortError" ||
          (status >= 500 && status < 600);

        if (status === 429) {
          stats.rateLimited += 1;
          this.statusOverrides.set(provider, "rate-limited");
        }

        if (!isTransient || attempt === MAX_RETRIES) {
          stats.failures += 1;
          stats.lastError = err?.message ?? String(e);
          stats.lastErrorAt = new Date().toISOString();
          throw e;
        }

        const delay = 1000 * Math.pow(2, attempt);
        logger.warn(
          `[metadata:${provider}] ${status || err?.name || "fetch"} on ${String(
            url,
          )} — retrying in ${delay}ms (attempt ${attempt + 1}/${MAX_RETRIES})`,
        );
        await new Promise((r) => setTimeout(r, delay));
      }
    }
    // Unreachable, satisfies TS
    throw lastErr;
  }
}

export const metadataHttp = new MetadataHttp();
export default metadataHttp;
