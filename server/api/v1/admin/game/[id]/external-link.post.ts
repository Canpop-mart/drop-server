import { type } from "arktype";
import { readDropValidatedBody, throwingArktype } from "~/server/arktype";
import aclManager from "~/server/internal/acls";
import prisma from "~/server/internal/db/database";
import type { ExternalAccountProvider } from "~/prisma/client/enums";

const CreateLink = type({
  provider: "'Steam' | 'RetroAchievements' | 'Goldberg'",
  externalGameId: "string",
}).configure(throwingArktype);

export default defineEventHandler(async (h3) => {
  const allowed = await aclManager.allowSystemACL(h3, ["game:update"]);
  if (!allowed) throw createError({ statusCode: 403 });

  const gameId = getRouterParam(h3, "id");
  if (!gameId) throw createError({ statusCode: 400, statusMessage: "No game ID." });

  const body = await readDropValidatedBody(h3, CreateLink);

  const link = await prisma.gameExternalLink.upsert({
    where: {
      gameId_provider: {
        gameId,
        provider: body.provider as ExternalAccountProvider,
      },
    },
    create: {
      gameId,
      provider: body.provider as ExternalAccountProvider,
      externalGameId: body.externalGameId,
    },
    update: {
      externalGameId: body.externalGameId,
    },
  });

  return link;
});
