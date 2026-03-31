import { type } from "arktype";
import { readDropValidatedBody, throwingArktype } from "~/server/arktype";
import aclManager from "~/server/internal/acls";
import prisma from "~/server/internal/db/database";
import type { ExternalAccountProvider } from "~/prisma/client/enums";

const UnlinkAccount = type({
  provider: "'Steam' | 'RetroAchievements' | 'Goldberg'",
}).configure(throwingArktype);

export default defineEventHandler(async (h3) => {
  const userId = await aclManager.getUserIdACL(h3, ["read"]);
  if (!userId) throw createError({ statusCode: 403 });

  const body = await readDropValidatedBody(h3, UnlinkAccount);

  await prisma.userExternalAccount.deleteMany({
    where: {
      userId,
      provider: body.provider as ExternalAccountProvider,
    },
  });

  return {};
});
