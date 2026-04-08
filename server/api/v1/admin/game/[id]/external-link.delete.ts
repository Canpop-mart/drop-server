import { type } from "arktype";
import { readDropValidatedBody, throwingArktype } from "~/server/arktype";
import aclManager from "~/server/internal/acls";
import prisma from "~/server/internal/db/database";
import type { ExternalAccountProvider } from "~/prisma/client/enums";

const DeleteLink = type({
  provider: "'Goldberg' | 'RetroAchievements'",
}).configure(throwingArktype);

export default defineEventHandler(async (h3) => {
  const allowed = await aclManager.allowSystemACL(h3, ["game:update"]);
  if (!allowed) throw createError({ statusCode: 403 });

  const gameId = getRouterParam(h3, "id");
  if (!gameId)
    throw createError({ statusCode: 400, statusMessage: "No game ID." });

  const body = await readDropValidatedBody(h3, DeleteLink);

  // Delete the external link
  const { count } = await prisma.gameExternalLink.deleteMany({
    where: {
      gameId,
      provider: body.provider as ExternalAccountProvider,
    },
  });

  if (count === 0) {
    throw createError({ statusCode: 404, statusMessage: "Link not found." });
  }

  // Also delete achievements from this provider for this game
  await prisma.achievement.deleteMany({
    where: {
      gameId,
      provider: body.provider as ExternalAccountProvider,
    },
  });

  return { deleted: true };
});
