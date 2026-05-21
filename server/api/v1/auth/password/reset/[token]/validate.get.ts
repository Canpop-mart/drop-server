import prisma from "~/server/internal/db/database";
import { hashResetToken } from "~/server/internal/auth/passwordReset";
import { requireRouterParam } from "~/server/arktype";

/**
 * Lightweight check used by the reset page on mount so it can render an
 * "expired link" state immediately rather than only after the user submits.
 * Returns { valid: boolean } and nothing else — no user info is exposed.
 */
export default defineEventHandler(async (h3) => {
  const token = requireRouterParam(h3, "token");

  const tokenHash = hashResetToken(token);
  const resetToken = await prisma.passwordResetToken.findUnique({
    where: { tokenHash },
    select: { expiresAt: true, consumedAt: true },
  });

  const valid =
    !!resetToken &&
    resetToken.consumedAt === null &&
    resetToken.expiresAt.getTime() >= Date.now();

  return { valid };
});
