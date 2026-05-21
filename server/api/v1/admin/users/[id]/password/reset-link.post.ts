import { defineEventHandler, createError } from "h3";
import { AuthMec } from "~/prisma/client/enums";
import aclManager from "~/server/internal/acls";
import prisma from "~/server/internal/db/database";
import {
  generateResetToken,
  hashResetToken,
  RESET_TOKEN_TTL_MS,
} from "~/server/internal/auth/passwordReset";
import { systemConfig } from "~/server/internal/config/sys-conf";
import { logger } from "~/server/internal/logging";

/**
 * Admin-driven password reset: mint a single-use, 1-hour reset link for a
 * target user. No email is sent — the admin copies the returned URL and hands
 * it to the user out-of-band. Redemption is handled by the existing
 * /auth/reset/[token] page + POST /api/v1/auth/password/reset endpoint, so the
 * token semantics here are identical to the self-service "forgot password"
 * flow.
 */
export default defineEventHandler(async (h3) => {
  // Admin ACL — same gate as the user-delete endpoint.
  const allowed = await aclManager.allowSystemACL(h3, ["user:delete"]);
  if (!allowed) throw createError({ statusCode: 403 });

  const userId = h3.context.params?.id;
  if (!userId)
    throw createError({
      statusCode: 400,
      statusMessage: "No userId in route.",
    });
  if (userId === "system")
    throw createError({
      statusCode: 400,
      statusMessage: "Cannot interact with system user.",
    });

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true },
  });
  if (!user)
    throw createError({ statusCode: 404, statusMessage: "User not found." });

  // A reset link is meaningless for users who don't authenticate with a
  // password (e.g. OIDC-only). Require an enabled Simple mechanism.
  const authMec = await prisma.linkedAuthMec.findFirst({
    where: { userId, mec: AuthMec.Simple, enabled: true },
    select: { userId: true },
  });
  if (!authMec)
    throw createError({
      statusCode: 400,
      message: "This user does not use password authentication.",
    });

  // Create the token. The raw token is only ever returned to this caller;
  // only its SHA-256 hash is persisted.
  const token = generateResetToken();
  const tokenHash = hashResetToken(token);
  const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS);

  await prisma.passwordResetToken.create({
    data: {
      userId,
      tokenHash,
      expiresAt,
    },
  });

  // Build the URL the same way the self-service forgot flow does.
  const url = `${systemConfig.getExternalUrl()}/auth/reset/${token}`;

  logger.info(`[AUTH] Admin generated a password reset link for user ${userId}.`);

  return { url, expiresAt };
});
