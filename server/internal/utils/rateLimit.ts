/*
 * Minimal in-memory token-bucket rate limiter.
 *
 * Drop has no rate-limit middleware, and the password-reset endpoints need
 * coarse abuse protection (per-IP and per-email request caps). This is a
 * deliberately small, dependency-free implementation:
 *
 *  - State lives in a Map in this process. It is NOT shared across a
 *    multi-instance deployment and is lost on restart. That is acceptable
 *    for "stop someone hammering forgot-password from one box" — it is not
 *    a security boundary, just a brake.
 *  - Each bucket refills linearly: `capacity` tokens per `windowMs`. A
 *    request consumes one token; when the bucket is empty the request is
 *    denied until enough time has passed to refill a token.
 *
 * Buckets are lazily evicted once they have refilled to full, so the Map
 * does not grow unbounded.
 */

interface Bucket {
  // Fractional tokens currently available.
  tokens: number;
  // Timestamp (ms) of the last refill calculation.
  lastRefill: number;
}

export interface RateLimiter {
  /**
   * Attempt to consume a token for `key`.
   * @returns true if allowed, false if the bucket is empty (rate limited).
   */
  consume: (key: string) => boolean;
  /** Drop the bucket for `key` (e.g. after a successful, legitimate action). */
  reset: (key: string) => void;
}

export interface RateLimitOptions {
  /** Max requests allowed per window (bucket capacity). */
  capacity: number;
  /** Window length in milliseconds over which the bucket fully refills. */
  windowMs: number;
}

/**
 * Create an isolated rate limiter. Each call returns its own bucket store, so
 * separate concerns (per-IP vs per-email) don't share counters.
 */
export function createRateLimiter(options: RateLimitOptions): RateLimiter {
  const { capacity, windowMs } = options;
  if (capacity <= 0 || windowMs <= 0) {
    throw new Error("createRateLimiter: capacity and windowMs must be > 0");
  }

  // Tokens regenerated per millisecond.
  const refillRate = capacity / windowMs;
  const buckets = new Map<string, Bucket>();

  function refill(bucket: Bucket, now: number) {
    const elapsed = now - bucket.lastRefill;
    if (elapsed <= 0) return;
    bucket.tokens = Math.min(capacity, bucket.tokens + elapsed * refillRate);
    bucket.lastRefill = now;
  }

  return {
    consume(key: string): boolean {
      const now = Date.now();
      let bucket = buckets.get(key);
      if (!bucket) {
        bucket = { tokens: capacity, lastRefill: now };
        buckets.set(key, bucket);
      } else {
        refill(bucket, now);
      }

      if (bucket.tokens < 1) {
        return false;
      }

      bucket.tokens -= 1;

      // Evict fully-refilled buckets to bound memory. A bucket at capacity
      // carries no useful state, so dropping it is equivalent to keeping it.
      if (bucket.tokens >= capacity) {
        buckets.delete(key);
      }
      return true;
    },
    reset(key: string) {
      buckets.delete(key);
    },
  };
}

/**
 * Resolve a best-effort client IP from an H3 event. Honours common reverse-
 * proxy headers and falls back to the socket address. Only used for coarse
 * rate-limit keying, so spoofed headers just mean an attacker rate-limits
 * themselves under a different key — not a security issue here.
 */
export function getClientIp(headers: Headers, fallback?: string): string {
  const forwardedFor = headers.get("x-forwarded-for");
  if (forwardedFor) {
    const first = forwardedFor.split(",")[0]?.trim();
    if (first) return first;
  }
  const realIp = headers.get("x-real-ip");
  if (realIp) return realIp.trim();
  return fallback ?? "unknown";
}
