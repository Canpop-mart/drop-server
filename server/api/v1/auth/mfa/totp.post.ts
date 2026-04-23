import { timingSafeEqual } from "node:crypto";
import sessionHandler from "~/server/internal/session";
import { type } from "arktype";
import prisma from "~/server/internal/db/database";
import { MFAMec } from "~/prisma/client/client";
import type { TOTPv1Credentials } from "~/server/internal/auth/totp";
import { dropDecodeArrayBase64 } from "~/server/internal/auth/totp";
import { SecretKey, totp } from "otp-io";
import { hmac } from "otp-io/crypto-web";
import { readDropValidatedBody, throwingArktype } from "~/server/arktype";

// TOTP codes roll over every 30 seconds. Clients with slightly skewed clocks
// (phones are usually NTP-synced, but not always) would otherwise fail on the
// boundary. RFC 6238 §5.2 recommends accepting one step on either side — we
// follow that, which tolerates up to ~90 seconds of drift in the worst case.
const TOTP_STEP_SECONDS = 30;
const TOTP_WINDOW_STEPS = 1;

const TOTPBody = type({
  // TOTP codes are always 6 ASCII digits. Bound the length so we don't spend
  // HMAC cycles on arbitrary-length payloads, and keep the character set tight.
  code: "/^[0-9]{6}$/",
}).configure(throwingArktype);

/**
 * Constant-time equality for same-length strings. Using string === leaks
 * timing information about how many leading digits matched; timingSafeEqual
 * on fixed-length buffers does not. Strings are coerced to UTF-8 buffers,
 * so they must already be length-matched by the caller.
 */
function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
}

export default defineEventHandler(async (h3) => {
  const session = await sessionHandler.getSession(h3);
  if (!session || !session.authenticated || session.authenticated.level == 0)
    throw createError({
      statusCode: 403,
      message: "Sign in before completing MFA",
    });

  const body = await readDropValidatedBody(h3, TOTPBody);

  const linkedMFAMec = await prisma.linkedMFAMec.findUnique({
    where: {
      userId_mec: {
        userId: session.authenticated.userId,
        mec: MFAMec.TOTP,
      },
    },
  });
  if (!linkedMFAMec)
    throw createError({ statusCode: 400, message: "TOTP not enabled" });

  const secret = (linkedMFAMec.credentials as unknown as TOTPv1Credentials)
    .secret;
  const secretKeyBuffer = dropDecodeArrayBase64(secret);
  const secretKey = new SecretKey(secretKeyBuffer);

  // Compute candidate codes across the accepted window (current step plus
  // ±TOTP_WINDOW_STEPS) and look for any match. Iterate through all of them
  // (don't short-circuit) so verification time stays constant whether the
  // valid step is the first or last checked — pairs with safeEqual for a
  // fully constant-time comparison against an attacker probing for timing
  // leaks about which step was valid.
  const nowMs = Date.now();
  let matched = false;
  for (let offset = -TOTP_WINDOW_STEPS; offset <= TOTP_WINDOW_STEPS; offset++) {
    const candidateNow = new Date(nowMs + offset * TOTP_STEP_SECONDS * 1000);
    const candidate = await totp(hmac, {
      secret: secretKey,
      now: candidateNow,
    });
    if (safeEqual(candidate, body.code)) matched = true;
  }
  if (!matched)
    throw createError({ statusCode: 403, message: "Invalid TOTP code." });

  await sessionHandler.mfa(h3, 10);

  return {};
});
