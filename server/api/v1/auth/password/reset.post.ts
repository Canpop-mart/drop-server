import { type } from "arktype";
import { AuthMec } from "~/prisma/client/enums";
import prisma from "~/server/internal/db/database";
import authManager, { createHashArgon2 } from "~/server/internal/auth";
import { hashResetToken } from "~/server/internal/auth/passwordReset";
import sessionHandler from "~/server/internal/session";
import { logger } from "~/server/internal/logging";

const resetValidator = type({
  token: "string",
  // Mirrors the 8-char minimum enforced at signup.
  password: "string >= 8",
});

export default defineEventHandler<{
  body: typeof resetValidator.infer;
}>(async (h3) => {
  const t = await useTranslation(h3);

  if (!authManager.getAuthProviders().Simple)
    throw createError({
      statusCode: 403,
      message: t("errors.auth.method.signinDisabled"),
    });

  const body = resetValidator(await readBody(h3));
  if (body instanceof type.errors) {
    throw createError({
      statusCode: 400,
      message: body.summary,
    });
  }

  // Look up the token by its hash — the raw token is never stored.
  const tokenHash = hashResetToken(body.token);
  const resetToken = await prisma.passwordResetToken.findUnique({
    where: { tokenHash },
  });

  // Single generic error for missing / consumed / expired so we don't reveal
  // which specific condition failed.
  const invalidTokenError = () =>
    createError({
      statusCode: 400,
      message: t("errors.auth.reset.invalidToken"),
    });

  if (!resetToken) throw invalidTokenError();
  if (resetToken.consumedAt) throw invalidTokenError();
  if (resetToken.expiresAt.getTime() < Date.now()) throw invalidTokenError();

  // The user must still have an enabled Simple mechanism to reset.
  const authMec = await prisma.linkedAuthMec.findFirst({
    where: {
      userId: resetToken.userId,
      mec: AuthMec.Simple,
      enabled: true,
    },
  });
  if (!authMec) throw invalidTokenError();

  const newHash = await createHashArgon2(body.password);

  // Atomically: write the new credentials (version 2 = argon2id, matching
  // signup) and mark the token consumed so it cannot be replayed.
  await prisma.$transaction([
    prisma.linkedAuthMec.update({
      where: {
        userId_mec: { userId: resetToken.userId, mec: AuthMec.Simple },
      },
      data: {
        version: 2,
        credentials: newHash,
      },
    }),
    prisma.passwordResetToken.update({
      where: { id: resetToken.id },
      data: { consumedAt: new Date() },
    }),
    // Invalidate any other still-pending reset tokens for this user — a
    // completed reset should void outstanding links.
    prisma.passwordResetToken.updateMany({
      where: {
        userId: resetToken.userId,
        consumedAt: null,
        id: { not: resetToken.id },
      },
      data: { consumedAt: new Date() },
    }),
  ]);

  // Force-logout every existing session for this user. If the account was
  // compromised, this evicts the attacker; the legitimate user simply signs
  // in again with their new password.
  const revoked = await sessionHandler.signoutAllByUser(resetToken.userId);
  logger.info(
    `[AUTH] Password reset completed for user ${resetToken.userId}; revoked ${revoked} session(s).`,
  );

  return { success: true };
});
