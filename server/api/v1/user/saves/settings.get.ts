import aclManager from "~/server/internal/acls";
import { applicationSettings } from "~/server/internal/config/application-configuration";

/**
 * Returns cloud save settings for the web UI.
 */
export default defineEventHandler(async (h3) => {
  const user = await aclManager.getUserACL(h3, ["store:read"]);
  if (!user) throw createError({ statusCode: 403 });

  const slotLimit = await applicationSettings.get("saveSlotCountLimit");
  const sizeLimit = await applicationSettings.get("saveSlotSizeLimit");
  const history = await applicationSettings.get("saveSlotHistoryLimit");
  return { slotLimit, sizeLimit, history };
});
