/**
 * CSRF protection via Origin / Referer header validation.
 *
 * Defense-in-depth against cross-site request forgery, layered on top of:
 *   1. SameSite=Lax cookies (server/internal/session/index.ts) — blocks most
 *      drive-by CSRF from form submits.
 *   2. CORS allowlist (nuxt.config.ts security.corsHandler.origin) — blocks
 *      cross-origin XHR in browsers.
 *
 * This middleware catches the residual class: legitimate same-origin exploits,
 * HTTP clients that don't honor SameSite (e.g., curl, postman), and older browsers.
 *
 * Strategy:
 *   - For unsafe methods (POST, PUT, PATCH, DELETE) on /api/v1/** routes,
 *     require the Origin (or Referer as fallback) header to match one of:
 *       * The request's own Host header
 *       * One of the configured ALLOWED_ORIGINS (same env var as CORS)
 *   - Skip enforcement for:
 *       * Safe methods (GET, HEAD, OPTIONS) — RFC 9110 says these should be
 *         side-effect-free. If an endpoint violates that, that's a bug to
 *         fix at the endpoint, not here.
 *       * /api/v1/client/** — the Tauri client authenticates with a JWT
 *         signed by its provisioned certificate (see event-handler.ts).
 *         CSRF is not applicable: the attacker would need the cert key,
 *         at which point they can just call the API directly. The server://
 *         custom protocol also doesn't set a conventional Origin header.
 *       * /api/v1/auth/oidc/callback — OAuth/OIDC callbacks are cross-origin
 *         by design (identity provider redirects to us). The state nonce
 *         in the callback URL is the CSRF defense for this flow.
 */

const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

// Routes that should NOT enforce origin checking — see rationale above.
const EXEMPT_PREFIXES = [
  "/api/v1/client/", // Tauri client, JWT-authenticated
  "/api/v1/auth/oidc/callback", // OIDC redirect, uses state nonce
];

function normalizeOrigin(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  try {
    const u = new URL(raw);
    // Reconstruct to drop path/query. Keep scheme + host + (non-default) port.
    return `${u.protocol}//${u.host}`;
  } catch {
    return undefined;
  }
}

function extractExpectedOrigins(hostHeader: string | undefined): Set<string> {
  const out = new Set<string>();

  // Always accept requests whose Origin matches the request's own Host.
  // This handles the common case where the frontend is served from the
  // same origin as the API.
  if (hostHeader) {
    out.add(`http://${hostHeader}`);
    out.add(`https://${hostHeader}`);
  }

  // Also accept any origin explicitly allowlisted via env var.
  const allowed = process.env.ALLOWED_ORIGINS;
  if (allowed) {
    for (const o of allowed
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)) {
      const normalized = normalizeOrigin(o);
      if (normalized) out.add(normalized);
    }
  }

  return out;
}

export default defineEventHandler((h3) => {
  // Only enforce in production — dev can have any number of origins (localhost:3000,
  // vite HMR, cross-device testing) and forcing origin discipline there slows iteration.
  if (process.env.NODE_ENV !== "production") return;

  const method = h3.method;
  if (!UNSAFE_METHODS.has(method)) return;

  const url = h3.path;
  if (!url.startsWith("/api/v1/")) return;
  for (const prefix of EXEMPT_PREFIXES) {
    if (url.startsWith(prefix)) return;
  }

  const originHeader = getHeader(h3, "Origin");
  const refererHeader = getHeader(h3, "Referer");
  const hostHeader = getHeader(h3, "Host");

  // Prefer Origin; fall back to Referer (older browsers, some mobile UAs).
  const candidate =
    normalizeOrigin(originHeader) ?? normalizeOrigin(refererHeader);

  if (!candidate) {
    throw createError({
      statusCode: 403,
      statusMessage:
        "Missing Origin and Referer headers on state-changing request.",
    });
  }

  const allowed = extractExpectedOrigins(hostHeader);
  if (!allowed.has(candidate)) {
    throw createError({
      statusCode: 403,
      statusMessage: `Origin ${candidate} not permitted for this endpoint.`,
    });
  }
});
