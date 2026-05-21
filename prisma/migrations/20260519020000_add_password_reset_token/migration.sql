-- Adds PasswordResetToken, backing the forgot-password flow.
--
-- Only a SHA-256 hash of the token is stored ("tokenHash"); the raw token
-- lives solely in the reset link emailed to the user. A DB leak therefore
-- cannot be replayed to reset anyone's password.
--
-- Tokens are single-use ("consumedAt") and time-boxed ("expiresAt", set to
-- 1 hour after creation by the application layer).

CREATE TABLE "PasswordResetToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PasswordResetToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PasswordResetToken_tokenHash_key"
    ON "PasswordResetToken" ("tokenHash");

CREATE INDEX "PasswordResetToken_userId_idx"
    ON "PasswordResetToken" ("userId");

CREATE INDEX "PasswordResetToken_expiresAt_idx"
    ON "PasswordResetToken" ("expiresAt");

ALTER TABLE "PasswordResetToken"
    ADD CONSTRAINT "PasswordResetToken_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
