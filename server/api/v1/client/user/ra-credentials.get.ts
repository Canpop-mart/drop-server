import { defineClientEventHandler } from "~/server/internal/clients/event-handler";
import prisma from "~/server/internal/db/database";
import { ExternalAccountProvider } from "~/prisma/client/enums";

/**
 * Returns the user's RetroAchievements Connect credentials for RetroArch.
 * Called by the desktop client before launching a RetroArch game so it can
 * inject `cheevos_username` and `cheevos_token` into retroarch.cfg.
 *
 * Returns { username, connectToken } or 404 if no RA account is linked.
 */
export default defineClientEventHandler(async (_h3, { fetchUser }) => {
  const user = await fetchUser();

  const account = await prisma.userExternalAccount.findUnique({
    where: {
      userId_provider: {
        userId: user.id,
        provider: ExternalAccountProvider.RetroAchievements,
      },
    },
    select: {
      externalId: true,
      connectToken: true,
    },
  });

  if (!account || !account.connectToken) {
    throw createError({
      statusCode: 404,
      statusMessage:
        "No RetroAchievements account linked or missing Connect token",
    });
  }

  return {
    username: account.externalId,
    connectToken: account.connectToken,
  };
});
