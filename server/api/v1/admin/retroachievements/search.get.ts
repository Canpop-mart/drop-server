import aclManager from "~/server/internal/acls";
import { createRAClient } from "~/server/internal/retroachievements";

export default defineEventHandler(async (h3) => {
  const allowed = await aclManager.allowSystemACL(h3, ["game:update"]);
  if (!allowed) throw createError({ statusCode: 403 });

  const query = getQuery(h3);
  const q = String(query.q ?? "").trim();

  if (!q) {
    throw createError({
      statusCode: 400,
      statusMessage: "Search query is required",
    });
  }

  const adminUsername = process.env.RA_USERNAME ?? "";
  const adminApiKey = process.env.RA_API_KEY ?? "";

  if (!adminUsername || !adminApiKey) {
    throw createError({
      statusCode: 500,
      statusMessage: "RetroAchievements integration not configured",
    });
  }

  const raClient = createRAClient(adminUsername, adminApiKey);
  const results = await raClient.searchGame(q);

  return results;
});
