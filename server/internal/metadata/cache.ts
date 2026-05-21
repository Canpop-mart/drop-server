/*
Provider-level cache for metadata responses.

The original code re-fetched everything on every call. `game-update` ran
6-hourly and pulled full game records from Steam even though Steam's
descriptions/screenshots change on the order of months. IGDB has a 4
req/sec hard limit, so a single library refresh was burning the budget
before it finished.

This is an in-memory LRU with per-call-type TTLs. The cache is keyed by
`provider:type:argHash` — collisions across providers are impossible
because the provider name is in the key. Failed lookups (undefined) are
also cached, with a shorter TTL — that's the whole point of the failed-
company-lookup followup from the audit checklist; without it, the
fallback chain re-asks IGDB for "the same nonexistent indie publisher"
on every imported game.

In-memory only for now. If a Postgres-backed layer is needed for cold
restarts, the read/write surface here (`get`/`set`/`invalidate`) is
intentionally narrow so it can be wrapped without changing call sites.

Note: we deliberately do NOT cache `fetchGame` results — they contain
ObjectReference IDs that only mean something inside the calling
transaction. Caching them would hand stale object IDs to a later
import. Search results and company lookups don't have that problem
because they're plain JSON.
*/
import { logger } from "~/server/internal/logging";

export type CacheCallType = "search" | "company" | "company-miss";

interface TtlConfig {
  ttlMs: number;
  maxEntries: number;
}

const TTL: Record<CacheCallType, TtlConfig> = {
  // Search is interactive — admin types into the box, gets back results.
  // 1 hour matches the audit checklist; long enough that re-typing the
  // same query is instant, short enough that adding a new game and
  // searching for it again works.
  search: { ttlMs: 60 * 60 * 1000, maxEntries: 500 },
  // Company metadata almost never changes (a publisher's name + logo
  // are basically forever). 30 days per the audit checklist.
  company: { ttlMs: 30 * 24 * 60 * 60 * 1000, maxEntries: 1000 },
  // Failed company lookups are the real win — same shorter TTL (1d) so
  // a typo or genuinely-missing company doesn't permanently block the
  // import path, but the chain doesn't re-ask 5 providers for the same
  // nothing on every imported game.
  "company-miss": { ttlMs: 24 * 60 * 60 * 1000, maxEntries: 2000 },
};

interface Entry<T> {
  value: T;
  expiresAt: number;
}

class MetadataCache {
  private store = new Map<string, Entry<unknown>>();
  private hits = 0;
  private misses = 0;

  private buildKey(
    provider: string,
    type: CacheCallType,
    args: string,
  ): string {
    return `${provider}:${type}:${args}`;
  }

  /**
   * LRU-ish eviction. Map preserves insertion order so deleting and
   * re-inserting on read is enough to track recency. When we exceed
   * the per-type cap, drop the first key we find for that type.
   */
  private evictIfNeeded(type: CacheCallType) {
    const cap = TTL[type].maxEntries;
    const prefix = `:${type}:`;
    let countForType = 0;
    let firstKeyForType: string | undefined;
    for (const k of this.store.keys()) {
      if (k.includes(prefix)) {
        countForType += 1;
        firstKeyForType ??= k;
      }
    }
    while (countForType > cap && firstKeyForType !== undefined) {
      this.store.delete(firstKeyForType);
      countForType -= 1;
      firstKeyForType = undefined;
      for (const k of this.store.keys()) {
        if (k.includes(prefix)) {
          firstKeyForType = k;
          break;
        }
      }
    }
  }

  get<T>(
    provider: string,
    type: CacheCallType,
    args: string,
  ): { hit: true; value: T } | { hit: false } {
    const key = this.buildKey(provider, type, args);
    const entry = this.store.get(key) as Entry<T> | undefined;
    if (!entry) {
      this.misses += 1;
      return { hit: false };
    }
    if (entry.expiresAt < Date.now()) {
      this.store.delete(key);
      this.misses += 1;
      return { hit: false };
    }
    // Touch for LRU
    this.store.delete(key);
    this.store.set(key, entry);
    this.hits += 1;
    return { hit: true, value: entry.value };
  }

  set<T>(provider: string, type: CacheCallType, args: string, value: T) {
    const key = this.buildKey(provider, type, args);
    const ttl = TTL[type];
    this.store.set(key, { value, expiresAt: Date.now() + ttl.ttlMs });
    this.evictIfNeeded(type);
  }

  /** Drop every entry for a provider — used when a provider is removed
   * or its credentials are rotated. */
  invalidateProvider(provider: string) {
    const prefix = `${provider}:`;
    let removed = 0;
    for (const k of this.store.keys()) {
      if (k.startsWith(prefix)) {
        this.store.delete(k);
        removed += 1;
      }
    }
    if (removed > 0)
      logger.info(`[metadata-cache] dropped ${removed} entries for ${provider}`);
  }

  stats() {
    const total = this.hits + this.misses;
    return {
      entries: this.store.size,
      hits: this.hits,
      misses: this.misses,
      hitRate: total === 0 ? 0 : this.hits / total,
    };
  }
}

export const metadataCache = new MetadataCache();
export default metadataCache;
