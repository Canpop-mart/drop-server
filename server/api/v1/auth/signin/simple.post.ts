import { AuthMec } from "~/prisma/client/enums";
import type { JsonArray } from "@prisma/client/runtime/client";
import { type } from "arktype";
import prisma from "~/server/internal/db/database";
import sessionHandler from "~/server/internal/session";
import authManager, {
  checkHashArgon2,
  checkHashBcrypt,
  createHashArgon2,
} from "~/server/internal/auth";
import { logger } from "~/server/internal/logging";

const signinValidator = type({
  username: "string",
  password: "string",
  "rememberMe?": "boolean | undefined",
});

export default defineEventHandler<{
  body: typeof signinValidator.infer;
}>(async (h3) => {
  const t = await useTranslation(h3);

  if (!authManager.getAuthProviders().Simple)
    throw createError({
      statusCode: 403,
      message: t("errors.auth.method.signinDisabled"),
    });

  const body = signinValidator(await readBody(h3));
  if (body instanceof type.errors) {
    // hover out.summary to see validation errors
    logger.error(body.summary);

    throw createError({
      statusCode: 400,
      message: body.summary,
    });
  }

  const authMek = await prisma.linkedAuthMec.findFirst({
    where: {
      mec: AuthMec.Simple,
      enabled: true,
      user: {
        username: body.username,
      },
    },
    include: {
      user: {
        select: {
          enabled: true,
        },
      },
    },
  });

  if (!authMek)
    throw createError({
      statusCode: 401,
      message: t("errors.auth.invalidUserOrPass"),
    });

  if (!authMek.user.enabled)
    throw createError({
      statusCode: 403,
      message: t("errors.auth.disabled"),
    });

  // LEGACY bcrypt
  if (authMek.version == 1) {
    const credentials = authMek.credentials as JsonArray | null;
    const hash = credentials?.at(1)?.toString();

    if (!hash)
      throw createError({
        statusCode: 500,
        message: t("errors.auth.invalidPassState"),
      });

    if (!(await checkHashBcrypt(body.password, hash)))
      throw createError({
        statusCode: 401,
        message: t("errors.auth.invalidUserOrPass"),
      });

    // Transparently migrate v1 (bcrypt) → v2 (argon2id). We have the plaintext
    // password in memory from the request, so we rehash with the newer algorithm
    // and persist the upgrade. If the migration write fails we still let the user
    // in (they successfully proved their password); we just try again next signin.
    try {
      const argon2Hash = await createHashArgon2(body.password);
      const res = await prisma.linkedAuthMec.updateMany({
        where: {
          userId: authMek.userId,
          mec: AuthMec.Simple,
        },
        data: {
          version: 2,
          credentials: argon2Hash,
        },
      });
      if (res.count === 0) {
        logger.warn(
          `[AUTH] Bcrypt→argon2 migration: no row updated for user ${authMek.userId} (race or deletion); will retry next signin.`,
        );
      } else {
        logger.info(
          `[AUTH] Migrated user ${authMek.userId} password from bcrypt (v1) to argon2 (v2).`,
        );
      }
    } catch (err) {
      logger.error(
        `[AUTH] Bcrypt→argon2 migration failed for user ${authMek.userId}: ${
          err instanceof Error ? err.message : String(err)
        }. Signin continues; will retry next time.`,
      );
    }

    const result = await sessionHandler.signin(h3, authMek.userId, {
      rememberMe: body.rememberMe ?? false,
    });
    if (result === "fail")
      throw createError({
        statusCode: 500,
        message: "Failed to create session",
      });

    return { result: result, userId: authMek.userId };
  }

  // V2: argon2
  const hash = authMek.credentials as string | undefined;
  if (!hash || typeof hash !== "string")
    throw createError({
      statusCode: 500,
      message: t("errors.auth.invalidPassState"),
    });

  if (!(await checkHashArgon2(body.password, hash)))
    throw createError({
      statusCode: 401,
      message: t("errors.auth.invalidUserOrPass"),
    });

  const result = await sessionHandler.signin(h3, authMek.userId, {
    rememberMe: body.rememberMe ?? false,
  });
  if (result == "fail")
    throw createError({ statusCode: 500, message: "Failed to create session" });
  return { userId: authMek.userId, result };
});
