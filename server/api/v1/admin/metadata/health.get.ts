import aclManager from "~/server/internal/acls";
import metadataHandler from "~/server/internal/metadata";

/**
 * GET /api/v1/admin/metadata/health
 *
 * Per-provider status payload for the admin metadata debug page
 * (`pages/admin/metadata/index.vue`). For every registered provider it
 * returns:
 *   - status — up | down | unauthenticated | rate-limited
 *   - stats — request count, failure count, rate-limit count, last error
 *
 * Plus a process-local cache hit-rate snapshot.
 *
 * Providers whose required env vars are missing never register (their
 * constructor throws and the init plugin skips them), so they simply
 * don't appear here. Scoped to `maintenance:read`.
 */
export default defineEventHandler(async (h3) => {
  const allowed = await aclManager.allowSystemACL(h3, ["maintenance:read"]);
  if (!allowed) throw createError({ statusCode: 403 });

  const providers = await metadataHandler.healthCheck();
  const cache = metadataHandler.cacheStats();

  return { providers, cache };
});
