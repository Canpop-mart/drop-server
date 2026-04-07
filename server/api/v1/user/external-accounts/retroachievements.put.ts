import { type } from "arktype";
import { readDropValidatedBody, throwingArktype } from "~/server/arktype";
import aclManager from "~/server/internal/acls";
import prisma from "~/server/internal/db/database";
import { ExternalAccountProvider } from "~/prisma/client/enums";
import { createRAClient } from "~/server/internal/retroachievements";
import { logger } from "~/server/internal/logging";

const LinkRAAccount = type({
  username: "string",
  apiKey: "string",
}).configure(throwingArktype);

export default defineEventHandler(async (h3) => {
  const userId = await aclManager.getUserIdACL(h3, ["read"]);
  if (!userId) throw createError({ statusCode: 403 });

  const body = await readDropValidatedBody(h3, LinkRAAccount);

  // Validate the user's credentials directly against RA API
  // (validateCredentials uses the provided username/apiKey, not admin creds)
  const raClient = createRAClient(body.username, body.apiKey);
  const isValid = await raClient.validateCredentials(
    body.username,
    body.apiKey,
  );

  if (!isValid) {
    throw createError({
      statusCode: 400,
      statusMessage: "Invalid RetroAchievements username or API key",
    });
  }

  // Store/update the external account
  const account = await prisma.userExternalAccount.upsert({
    where: {
      userId_provider: {
        userId,
        provider: ExternalAccountProvider.RetroAchievements,
      },
    },
    create: {
      userId,
      provider: ExternalAccountProvider.RetroAchievements,
      externalId: body.username,
      token: body.apiKey,
    },
    update: {
      externalId: body.username,
      token: body.apiKey,
    },
    select: {
      id: true,
      provider: true,
      externalId: true,
    },
  });

  logger.info(
    `User ${userId} linked RetroAchievements account: ${body.username}`,
  );

  return account;
});
