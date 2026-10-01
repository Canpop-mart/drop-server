import aclManager from "~/server/internal/acls";
import { serverHasRACredentials } from "~/server/internal/retroachievements";

/**
 * Which achievement-related server credentials are configured, so the admin
 * achievements page can say up front why Steam or RA fetches come back empty.
 * Only presence is reported, never the values.
 */
export default defineEventHandler(async (h3) => {
  const allowed = await aclManager.allowSystemACL(h3, ["game:update"]);
  if (!allowed) throw createError({ statusCode: 403 });

  return {
    steamApiKeySet: !!process.env.STEAM_API_KEY,
    raServerCredentialsSet: serverHasRACredentials(),
  };
});
