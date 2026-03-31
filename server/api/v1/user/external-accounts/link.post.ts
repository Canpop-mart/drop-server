import { type } from "arktype";
import { readDropValidatedBody, throwingArktype } from "~/server/arktype";
import aclManager from "~/server/internal/acls";
import prisma from "~/server/internal/db/database";
import type { ExternalAccountProvider } from "~/prisma/client/enums";

const LinkAccount = type({
  provider: "'Steam' | 'RetroAchievements' | 'Goldberg'",
  externalId: "string",
}).configure(throwingArktype);

export default defineEventHandler(async (h3) => {
  const userId = await aclManager.getUserIdACL(h3, ["read"]);
  if (!userId) throw createError({ statusCode: 403 });

  const body = await readDropValidatedBody(h3, LinkAccount);

  const account = await prisma.userExternalAccount.upsert({
    where: {
      userId_provider: {
        userId,
        provider: body.provider as ExternalAccountProvider,
      },
    },
    create: {
      userId,
      provider: body.provider as ExternalAccountProvider,
      externalId: body.externalId,
    },
    update: {
      externalId: body.externalId,
    },
  });

  return account;
});
