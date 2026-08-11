-- Carry the host's reason for giving up back to the device that asked for the
-- stream. Without it a failed host just marks the session Stopped, and the
-- requesting device can only report the generic "no host responded" timeout.
-- Nullable: a normal stop leaves it null, and older clients never send it.

ALTER TABLE "StreamingSession" ADD COLUMN "error" TEXT;
