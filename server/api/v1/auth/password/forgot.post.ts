import { type } from "arktype";
import { AuthMec } from "~/prisma/client/enums";
import prisma from "~/server/internal/db/database";
import authManager from "~/server/internal/auth";
import {
  generateResetToken,
  hashResetToken,
  RESET_TOKEN_TTL_MS,
} from "~/server/internal/auth/passwordReset";
import emailManager, {
  buildPasswordResetEmail,
} from "~/server/internal/email";
import { systemConfig } from "~/server/internal/config/sys-conf";
import { logger } from "~/server/internal/logging";
import {
  createRateLimiter,
  getClientIp,
} from "~/server/internal/utils/rateLimit";

const forgotValidator = type({
  email: "string.email",
});

// Coarse abuse protection. Both limiters allow 5 requests/hour; the 6th within
// the window is rejected. State is per-process (see rateLimit.ts) — a brake,
// not a security boundary.
const RATE_LIMIT = { capacity: 5, windowMs: 60 * 60 * 1000 };
const ipLimiter = createRateLimiter(RATE_LIMIT);
const emailLimiter = createRateLimiter(RATE_LIMIT);

export default defineEventHandler<{
  body: typeof forgotValidator.infer;
}>(async (h3) => {
  const t = await useTranslation(h3);

  // Constant response regardless of outcome: we must not reveal whether an
  // email is registered, nor whether it has Simple auth, nor whether we are
  // rate limited (a differing status code would itself leak signal).
  const constantResponse = { message: t("auth.forgot.genericResponse") };

  if (!authManager.getAuthProviders().Simple) {
    // Simple auth disabled entirely — nothing to reset. Still return 200.
    return constantResponse;
  }

  const body = forgotValidator(await readBody(h3));
  if (body instanceof type.errors) {
    // A malformed email can't match anyone; respond identically.
    return constantResponse;
  }

  // Normalise for consistent rate-limit keying.
  const email = body.email.trim().toLowerCase();

  const ip = getClientIp(
    h3.headers,
    h3.node.req.socket?.remoteAddress ?? undefined,
  );

  // Rate limit per IP and per email. If either bucket is empty, silently stop
  // — the caller still sees the same 200 response.
  const ipAllowed = ipLimiter.consume(ip);
  const emailAllowed = emailLimiter.consume(email);
  if (!ipAllowed || !emailAllowed) {
    logger.warn(
      `[AUTH] Password reset rate limited (ip=${ip}, ipAllowed=${ipAllowed}, emailAllowed=${emailAllowed})`,
    );
    return constantResponse;
  }

  // Look up a user with a usable Simple auth mechanism. User.email is not
  // unique, so match the first enabled Simple mechanism for that address.
  const authMec = await prisma.linkedAuthMec.findFirst({
    where: {
      mec: AuthMec.Simple,
      enabled: true,
      user: {
        email,
        enabled: true,
      },
    },
    select: { userId: true },
  });

  if (!authMec) {
    // No matching account — respond as if we sent an email.
    return constantResponse;
  }

  // Create the token. The raw token only ever leaves in the email link.
  const token = generateResetToken();
  const tokenHash = hashResetToken(token);
  const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS);

  await prisma.passwordResetToken.create({
    data: {
      userId: authMec.userId,
      tokenHash,
      expiresAt,
    },
  });

  const resetUrl = `${systemConfig.getExternalUrl()}/auth/reset/${token}`;
  const mail = buildPasswordResetEmail(resetUrl);
  // send() never throws; failures are logged. Response stays constant.
  await emailManager.send({
    to: email,
    subject: mail.subject,
    text: mail.text,
    html: mail.html,
  });

  return constantResponse;
});
