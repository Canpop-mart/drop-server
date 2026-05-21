import aclManager from "~/server/internal/acls";
import metadataHandler from "~/server/internal/metadata";
import { type } from "arktype";

/**
 * POST /api/v1/admin/metadata/test-fetch
 *
 * Powers the "test fetch" form on the admin metadata debug page. Runs a
 * search across every configured provider and reports back the results
 * grouped by provider, so an admin can confirm a provider is reachable
 * and authenticated without actually importing a game.
 *
 * This is search-only on purpose — `fetchGame` creates objects and is
 * not safely re-runnable from a debug form. Scoped to `maintenance:read`.
 */
const testFetchBody = type({
  query: "string > 0",
});

export default defineEventHandler(async (h3) => {
  const allowed = await aclManager.allowSystemACL(h3, ["maintenance:read"]);
  if (!allowed) throw createError({ statusCode: 403 });

  const raw = await readBody(h3);
  const body = testFetchBody(raw);
  if (body instanceof type.errors)
    throw createError({ statusCode: 400, statusMessage: body.summary });

  const started = Date.now();
  const results = await metadataHandler.search(body.query);
  const elapsedMs = Date.now() - started;

  // Group by source so the UI can show "Steam: 3 hits, IGDB: 1 hit".
  const bySource: Record<string, number> = {};
  for (const r of results) {
    bySource[r.sourceName] = (bySource[r.sourceName] ?? 0) + 1;
  }

  return {
    query: body.query,
    elapsedMs,
    totalResults: results.length,
    bySource,
    results: results.slice(0, 25),
  };
});
