import { type } from "arktype";
import type { JsonArray } from "@prisma/client/runtime/client";
import { AuthMec } from "~/prisma/client/enums";
import aclManager from "~/server/internal/acls";
import prisma from "~/server/internal/db/database";
import {
  checkHashArgon2,
  checkHashBcrypt,
  createHashArgon2,
} from "~/server/internal/auth";
import { logger } from "~/server/internal/logging";

const changePasswordValidator = type({
  currentPassword: "string",
  // Mirrors the 8-char minimum enforced at signup.
  newPassword: "string >= 8",
});

/**
 * Change password for the currently signed-in user.
 *
 * Unlike the reset flow this deliberately does NOT invalidate other sessions —
 * the user proved knowledge of the current password, so it is a routine
 * rotation, not a compromise recovery. The acting session is untouched.
 */
export default defineEventHandler<{
  body: typeof changePasswordValidator.infer;
}>(async (h3) => {
  const t = await useTranslation(h3);

  // No ACLs => session authentication only (cannot be done with an API token).
  const userId = await aclManager.getUserIdACL(h3, []);
  if (!userId) throw createError({ statusCode: 403 });

  const body = changePasswordValidator(await readBody(h3));
  if (body instanceof type.errors) {
    throw createError({
      statusCode: 400,
      message: body.summary,
    });
  }

  const authMec = await prisma.linkedAuthMec.findFirst({
    where: {
      userId,
      mec: AuthMec.Simple,
      enabled: true,
    },
  });
  if (!authMec)
    throw createError({
      statusCode: 400,
      message: t("errors.auth.method.signinDisabled"),
    });

  // Verify the current password using the same algorithm matrix as
  // signin/simple.post.ts: version 1 = legacy bcrypt, version 2 = argon2id.
  let currentValid = false;
  if (authMec.version === 1) {
    const credentials = authMec.credentials as JsonArray | null;
    const hash = credentials?.at(1)?.toString();
    if (!hash)
      throw createError({
        statusCode: 500,
        message: t("errors.auth.invalidPassState"),
      });
    currentValid = await checkHashBcrypt(body.currentPassword, hash);
  } else {
    const hash = authMec.credentials as string | undefined;
    if (!hash || typeof hash !== "string")
      throw createError({
        statusCode: 500,
        message: t("errors.auth.invalidPassState"),
      });
    currentValid = await checkHashArgon2(body.currentPassword, hash);
  }

  if (!currentValid)
    throw createError({
      statusCode: 401,
      message: t("errors.auth.invalidCurrentPassword"),
    });

  // Persist the new credentials, always upgrading to argon2id (version 2).
  await prisma.linkedAuthMec.update({
    where: {
      userId_mec: { userId, mec: AuthMec.Simple },
    },
    data: {
      version: 2,
      credentials: await createHashArgon2(body.newPassword),
    },
  });

  logger.info(`[AUTH] User ${userId} changed their password.`);

  return { success: true };
});
