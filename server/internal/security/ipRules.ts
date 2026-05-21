/*
 * In-process cache and decision logic for the IP allowlist / blocklist.
 *
 * The `ip-filter` Nitro middleware runs on every request, so it must not
 * hit the database each time. Instead the full rule list is loaded into a
 * module-level array once at startup (lazily, on first use) and refreshed
 * by `reloadIpRules()` whenever an admin endpoint mutates a rule.
 *
 * The same `isIpAdmitted` decision function is reused by the admin
 * endpoints' lockout guard: before persisting a rule they simulate the
 * post-change rule set and check the requesting admin's own IP against it.
 */

import type { H3Event } from "h3";
import { IpRuleKind } from "~/prisma/client/enums";
import prisma from "../db/database";
import { ipMatchesPattern } from "../utils/ipMatch";
import { getClientIp } from "../utils/rateLimit";

/** A minimal rule shape — only what the matcher needs. */
export interface IpRuleLike {
  kind: IpRuleKind;
  pattern: string;
  enabled: boolean;
}

// Module-level cache. `null` means "never loaded"; an array (even empty)
// means the cache is warm. Lives for the lifetime of the process.
let cachedRules: IpRuleLike[] | null = null;

/**
 * Decide whether `clientIp` is admitted under `rules`.
 *
 * Ordering (matches the spec):
 *   - Disabled rules are ignored entirely.
 *   - If ANY enabled Allow rule exists, the server is default-deny: the IP
 *     is admitted only if it matches at least one enabled Allow.
 *   - Otherwise the IP is admitted unless it matches an enabled Deny.
 *
 * This function is pure — it takes the rule set explicitly — so the admin
 * lockout guard can call it against a hypothetical post-change rule set.
 */
export function isIpAdmitted(clientIp: string, rules: IpRuleLike[]): boolean {
  const enabled = rules.filter((r) => r.enabled);
  const allowRules = enabled.filter((r) => r.kind === IpRuleKind.Allow);
  const denyRules = enabled.filter((r) => r.kind === IpRuleKind.Deny);

  if (allowRules.length > 0) {
    // Default-deny mode: an Allow match is required.
    return allowRules.some((r) => ipMatchesPattern(clientIp, r.pattern));
  }

  // Default-allow mode: blocked only by a Deny match.
  return !denyRules.some((r) => ipMatchesPattern(clientIp, r.pattern));
}

/**
 * Return the cached rule list, loading it from the database on first use.
 * Callers must not mutate the returned array.
 */
export async function getIpRules(): Promise<IpRuleLike[]> {
  if (cachedRules === null) {
    await reloadIpRules();
  }
  return cachedRules ?? [];
}

/**
 * Reload the rule cache from the database. Admin CRUD endpoints call this
 * after every mutation so changes take effect on the next request without
 * a server restart.
 */
export async function reloadIpRules(): Promise<void> {
  const rules = await prisma.ipRule.findMany({
    select: { kind: true, pattern: true, enabled: true },
  });
  cachedRules = rules;
}

/**
 * Synchronous accessor for the already-loaded cache. Returns an empty
 * array if the cache has not been warmed yet. The middleware uses the
 * async `getIpRules()` for its first call; this exists for code paths
 * that must not await.
 */
export function getIpRulesSync(): IpRuleLike[] {
  return cachedRules ?? [];
}

/**
 * Whether reverse-proxy forwarding headers (`X-Forwarded-For`,
 * `X-Real-IP`) should be trusted. Controlled by env var DROP_TRUST_PROXY,
 * default true — a Drop install behind a reverse proxy is the common case.
 * An explicit "false" / "0" / "no" / "off" opts out for directly-exposed
 * deployments where a client could otherwise spoof its IP past the filter.
 */
export function trustProxy(): boolean {
  const raw = process.env.DROP_TRUST_PROXY;
  if (raw === undefined) return true;
  const normalized = raw.trim().toLowerCase();
  return !["false", "0", "no", "off"].includes(normalized);
}

/**
 * Resolve the client IP for an H3 request. Reuses `getClientIp` from the
 * rate-limit helper, but only honours forwarding headers when the
 * deployment trusts its proxy (see `trustProxy`). When the proxy is not
 * trusted the spoofable headers are dropped so the real socket peer wins.
 *
 * Shared by the `ip-filter` middleware and the admin endpoints' lockout
 * guard so both judge an IP identically.
 */
export function resolveClientIp(h3: H3Event): string {
  const socketIp = h3.node.req.socket?.remoteAddress ?? undefined;

  if (trustProxy()) {
    return getClientIp(h3.headers, socketIp);
  }

  const stripped = new Headers(h3.headers);
  stripped.delete("x-forwarded-for");
  stripped.delete("x-real-ip");
  return getClientIp(stripped, socketIp);
}
