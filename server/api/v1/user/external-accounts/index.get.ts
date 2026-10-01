import aclManager from "~/server/internal/acls";
import prisma from "~/server/internal/db/database";
import { serverHasRACredentials } from "~/server/internal/retroachievements";

export default defineEventHandler(async (h3) => {
  const userId = await aclManager.getUserIdACL(h3, ["read"]);
  if (!userId) throw createError({ statusCode: 403 });

  const externalAccounts = await prisma.userExternalAccount.findMany({
    where: { userId },
    select: {
      id: true,
      provider: true,
      externalId: true,
      // Never sent: the tokens themselves. Only whether a Connect token exists.
      connectToken: true,
    },
  });

  return {
    accounts: externalAccounts.map(({ connectToken, ...a }) => ({
      ...a,
      // False for an RA account linked before Connect tokens were stored:
      // RetroArch can't sign in with it until the player signs in again.
      hasConnectToken: connectToken !== "",
    })),
    // Whether linking RetroAchievements needs the player's own Web API key.
    // False when the server has RA_USERNAME / RA_API_KEY of its own.
    raApiKeyRequired: !serverHasRACredentials(),
  };
});
