import { defineEventHandler, createError, readBody } from "h3";
import { type } from "arktype";
import { AuthMec } from "~/prisma/client/enums";
import aclManager from "~/server/internal/acls";
import prisma from "~/server/internal/db/database";
import { createHashArgon2 } from "~/server/internal/auth";
import sessionHandler from "~/server/internal/session";
import { logger } from "~/server/internal/logging";

// Mirrors the 8-char minimum enforced at signup / self-service reset.
const setPasswordValidator = type({
  password: "string >= 8",
});

/**
 * Admin-driven password reset: set a target user's Simple-auth password
 * directly. No token, no email — the admin types the new password and tells
 * the user out-of-band. All of the target user's existing sessions are
 * invalidated so they must sign in again with the new credentials.
 */
export default defineEventHandler<{
  body: typeof setPasswordValidator.infer;
}>(async (h3) => {
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

  const body = setPasswordValidator(await readBody(h3));
  if (body instanceof type.errors)
    throw createError({ statusCode: 400, message: body.summary });

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true },
  });
  if (!user)
    throw createError({ statusCode: 404, statusMessage: "User not found." });

  // Only meaningful for password-auth users — OIDC-only users have no Simple
  // mechanism to write credentials into.
  const authMec = await prisma.linkedAuthMec.findFirst({
    where: { userId, mec: AuthMec.Simple, enabled: true },
    select: { userId: true },
  });
  if (!authMec)
    throw createError({
      statusCode: 400,
      message: "This user does not use password authentication.",
    });

  // Write the new credentials (version 2 = argon2id, matching signup).
  const newHash = await createHashArgon2(body.password);
  await prisma.linkedAuthMec.update({
    where: { userId_mec: { userId, mec: AuthMec.Simple } },
    data: { version: 2, credentials: newHash },
  });

  // Force-logout every existing session for this user so the old password
  // can no longer be used to stay signed in.
  const revoked = await sessionHandler.signoutAllByUser(userId);
  logger.info(
    `[AUTH] Admin set a new password for user ${userId}; revoked ${revoked} session(s).`,
  );

  return { success: true };
});
