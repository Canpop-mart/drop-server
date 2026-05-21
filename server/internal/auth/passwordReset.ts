/*
 * Helpers for the password-reset token lifecycle.
 *
 * A reset token is 32 random bytes, hex-encoded (64 chars), placed in the
 * emailed link. Only its SHA-256 hash is persisted (PasswordResetToken.
 * tokenHash). Lookups therefore hash the incoming token and match on the
 * hash, so the raw token never touches the database.
 */

import { randomBytes, createHash } from "node:crypto";

// 1 hour, in milliseconds.
export const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;

/** Generate a fresh raw reset token (hex-encoded, 32 bytes of entropy). */
export function generateResetToken(): string {
  return randomBytes(32).toString("hex");
}

/** SHA-256 hash of a raw token, hex-encoded — this is what we store/query. */
export function hashResetToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
