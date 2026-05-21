/**
 * IP allowlist / blocklist enforcement.
 *
 * Drop has no IP-based access control out of the box: anyone who can reach
 * the server URL can hit every endpoint. This middleware lets a self-hoster
 * on a public IP put a firewall layer in front of the whole app, configured
 * from the admin UI (see pages/admin/settings/security.vue).
 *
 * Decision logic lives in server/internal/security/ipRules.ts (`isIpAdmitted`)
 * and is shared with the admin endpoints' lockout guard. In short:
 *   - If any enabled Allow rule exists -> default-deny (only Allow matches in).
 *   - Otherwise -> default-allow (everything in except enabled Deny matches).
 *
 * Safety rails — these always bypass the filter so an operator cannot brick
 * their own box with a bad rule:
 *   - Health endpoints (so load balancers / uptime checks keep working).
 *   - Loopback addresses (127.0.0.1, ::1) — the operator on the host itself.
 *
 * Client IP resolution reuses `getClientIp` from the rate-limit helper via
 * the shared `resolveClientIp`. The `X-Forwarded-For` / `X-Real-IP` headers
 * are only trusted when the env var DROP_TRUST_PROXY is truthy (default
 * true): a Drop install behind a reverse proxy is the common case.
 * Operators exposing Drop directly should set DROP_TRUST_PROXY=false so a
 * client cannot spoof its IP past the filter.
 */

import {
  getIpRules,
  isIpAdmitted,
  resolveClientIp,
} from "~/server/internal/security/ipRules";

// Loopback addresses always admitted — the operator on the host itself.
const LOOPBACK_IPS = new Set(["127.0.0.1", "::1"]);

/** Health endpoints bypass the filter so uptime checks keep working. */
function isHealthPath(path: string): boolean {
  // Drop's health surface lives under /api/v1/admin/*/health and any
  // bare /health route. Match defensively on the segment.
  if (path === "/health" || path.startsWith("/health/")) return true;
  if (path.endsWith("/health")) return true;
  if (path.includes("/health?")) return true;
  return false;
}

export default defineEventHandler(async (h3) => {
  const path = h3.path;

  // Health endpoints are never filtered.
  if (isHealthPath(path)) return;

  const clientIp = resolveClientIp(h3);

  // Loopback is never filtered — the operator must always be able to
  // reach their own box, even with a default-deny allowlist in place.
  if (LOOPBACK_IPS.has(clientIp)) return;

  const rules = await getIpRules();

  // No rules configured at all: nothing to enforce, fast path.
  if (rules.length === 0) return;

  if (!isIpAdmitted(clientIp, rules)) {
    // Generic 403 — do not leak whether an allowlist or blocklist is in
    // effect, or which rule matched.
    throw createError({
      statusCode: 403,
      data: { error: "Forbidden" },
      statusMessage: "Forbidden",
    });
  }
});
