import { type } from "arktype";
import { readDropValidatedBody, throwingArktype } from "~/server/arktype";
import aclManager from "~/server/internal/acls";
import prisma from "~/server/internal/db/database";
import { ExternalAccountProvider } from "~/prisma/client/enums";
import {
  createRAClient,
  serverHasRACredentials,
} from "~/server/internal/retroachievements";
import { logger } from "~/server/internal/logging";

const LinkRAAccount = type({
  username: "string",
  "apiKey?": "string",
  password: "string",
}).configure(throwingArktype);

/**
 * Links (or re-links) the caller's RetroAchievements account.
 *
 * Used by the web account page AND the desktop client (desktop settings, Big
 * Picture settings and the welcome wizard all call it through server://), so
 * the server always knows the player's RA username. Without that, ra-poll and
 * session-end have nobody to look up and every RA game stays at 0/N.
 *
 * - `password` is always required. It is exchanged once with RA's login2 for
 *   the Connect token RetroArch signs in with, which also proves the player
 *   owns the username. It is never stored.
 * - `apiKey` (the player's RA Web API key) is optional when the server has its
 *   own RA_USERNAME / RA_API_KEY: progress is then read with the server's
 *   credentials plus the player's username. Without server credentials it is
 *   required. When supplied it is always validated.
 *
 * Returns the account plus `connectToken`, so the desktop client can keep a
 * local copy for RetroArch without a second round trip.
 */
export default defineEventHandler(async (h3) => {
  const userId = await aclManager.getUserIdACL(h3, ["read"]);
  if (!userId) throw createError({ statusCode: 403 });

  const body = await readDropValidatedBody(h3, LinkRAAccount);
  const username = body.username.trim();
  const apiKey = body.apiKey?.trim() ?? "";

  if (!username || !body.password) {
    throw createError({
      statusCode: 400,
      statusMessage: "Enter your RetroAchievements username and password.",
    });
  }

  // A previously stored Web API key for the same RA account is kept when
  // re-linking without one (the web page can't prefill it: the key is never
  // sent back to the browser). A key for a different username is useless.
  const existing = await prisma.userExternalAccount.findUnique({
    where: {
      userId_provider: {
        userId,
        provider: ExternalAccountProvider.RetroAchievements,
      },
    },
    select: { externalId: true, token: true },
  });
  const sameAccount = (name: string) =>
    !!existing && existing.externalId.toLowerCase() === name.toLowerCase();

  if (
    !apiKey &&
    !serverHasRACredentials() &&
    !(sameAccount(username) && existing?.token)
  ) {
    throw createError({
      statusCode: 400,
      statusMessage:
        "This server needs your RetroAchievements Web API key to track unlocks.",
    });
  }

  // Validate the Web API key against RA API
  if (apiKey) {
    const raClient = createRAClient(username, apiKey);
    const isValid = await raClient.validateCredentials(username, apiKey);
    if (!isValid) {
      throw createError({
        statusCode: 400,
        statusMessage: "Invalid RetroAchievements username or API key",
      });
    }
  }

  // Exchange password for Connect token via RA login API.
  // This token is used by RetroArch for in-game achievement tracking.
  // Sent as a form body, not query parameters, so the password never lands
  // in a URL (and from there in a proxy or access log).
  let connectToken = "";
  let canonicalUsername = username;
  try {
    const loginResponse = await fetch(
      "https://retroachievements.org/dorequest.php",
      {
        method: "POST",
        headers: {
          "User-Agent": "Drop/1.0",
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          r: "login2",
          u: username,
          p: body.password,
        }).toString(),
      },
    );

    // RA answers a bad password with a non-2xx status AND a JSON body that
    // says why, so read the body either way.
    const loginData = (await loginResponse.json().catch(() => null)) as {
      Success?: boolean;
      Token?: string;
      User?: string;
      Error?: string;
    } | null;
    if (loginData?.Success && loginData.Token) {
      connectToken = loginData.Token;
      if (loginData.User) canonicalUsername = loginData.User;
      logger.info(`[RA] Connect token obtained for user ${canonicalUsername}`);
    } else if (loginData?.Error) {
      throw new Error(loginData.Error);
    } else {
      throw new Error(`RetroAchievements returned ${loginResponse.status}`);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.warn(`[RA] Failed to get Connect token for ${username}: ${msg}`);
    throw createError({
      statusCode: 400,
      statusMessage: `RetroAchievements sign in failed: ${msg}`,
    });
  }

  const storedKey =
    apiKey || (sameAccount(canonicalUsername) ? (existing?.token ?? "") : "");

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
      externalId: canonicalUsername,
      token: storedKey,
      connectToken,
    },
    update: {
      externalId: canonicalUsername,
      token: storedKey,
      connectToken,
    },
    select: {
      id: true,
      provider: true,
      externalId: true,
    },
  });

  logger.info(
    `User ${userId} linked RetroAchievements account: ${canonicalUsername} ` +
      `(own API key: ${storedKey ? "yes" : "no, using server credentials"})`,
  );

  return { ...account, connectToken };
});
