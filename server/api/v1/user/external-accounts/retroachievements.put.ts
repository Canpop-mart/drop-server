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
  password: "string",
}).configure(throwingArktype);

export default defineEventHandler(async (h3) => {
  const userId = await aclManager.getUserIdACL(h3, ["read"]);
  if (!userId) throw createError({ statusCode: 403 });

  const body = await readDropValidatedBody(h3, LinkRAAccount);

  // Validate the Web API key against RA API
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

  // Exchange password for Connect token via RA login API.
  // This token is used by RetroArch for in-game achievement tracking.
  let connectToken = "";
  try {
    const loginUrl = new URL("https://retroachievements.org/dorequest.php");
    loginUrl.searchParams.set("r", "login2");
    loginUrl.searchParams.set("u", body.username);
    loginUrl.searchParams.set("p", body.password);

    const loginResponse = await fetch(loginUrl.toString(), {
      headers: { "User-Agent": "Drop/1.0" },
    });

    if (loginResponse.ok) {
      const loginData = (await loginResponse.json()) as {
        Success: boolean;
        Token: string;
      };
      if (loginData.Success && loginData.Token) {
        connectToken = loginData.Token;
        logger.info(`[RA] Connect token obtained for user ${body.username}`);
      } else {
        throw new Error("Login failed — check your password");
      }
    } else {
      throw new Error(`RA login returned ${loginResponse.status}`);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.warn(
      `[RA] Failed to get Connect token for ${body.username}: ${msg}`,
    );
    throw createError({
      statusCode: 400,
      statusMessage: `RetroAchievements password invalid or login failed: ${msg}`,
    });
  }

  // Store/update the external account (password is NOT stored)
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
      connectToken,
    },
    update: {
      externalId: body.username,
      token: body.apiKey,
      connectToken,
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
