import aclManager from "~/server/internal/acls";
import {
  createRAClient,
  resolveRACredentials,
} from "~/server/internal/retroachievements";

export default defineEventHandler(async (h3) => {
  const allowed = await aclManager.allowSystemACL(h3, ["game:update"]);
  if (!allowed) throw createError({ statusCode: 403 });

  const userId = await aclManager.getUserIdACL(h3, ["read"]);
  if (!userId) throw createError({ statusCode: 403 });

  const query = getQuery(h3);
  const q = String(query.q ?? "").trim();

  if (!q) {
    throw createError({
      statusCode: 400,
      statusMessage: "Search query is required",
    });
  }

  const raCreds = await resolveRACredentials(userId);
  if (!raCreds) {
    throw createError({
      statusCode: 500,
      statusMessage:
        "RetroAchievements not configured. Set RA_USERNAME/RA_API_KEY or link your RA account in Settings.",
    });
  }

  const raClient = createRAClient(raCreds.username, raCreds.apiKey);
  const results = await raClient.searchGame(q);

  return results;
});
