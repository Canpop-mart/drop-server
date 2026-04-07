import aclManager from "~/server/internal/acls";
import prisma from "~/server/internal/db/database";
import { ExternalAccountProvider } from "~/prisma/client/enums";
import { logger } from "~/server/internal/logging";

export default defineEventHandler(async (h3) => {
  const userId = await aclManager.getUserIdACL(h3, ["read"]);
  if (!userId) throw createError({ statusCode: 403 });

  const deleted = await prisma.userExternalAccount.deleteMany({
    where: {
      userId,
      provider: ExternalAccountProvider.RetroAchievements,
    },
  });

  if (deleted.count === 0) {
    throw createError({
      statusCode: 404,
      statusMessage: "RetroAchievements account not linked",
    });
  }

  logger.info(`User ${userId} unlinked RetroAchievements account`);

  return {
    unlinked: true,
  };
});
