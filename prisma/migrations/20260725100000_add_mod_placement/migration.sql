-- Per-game mod placement config.

-- modRoot: subdirectory (relative to install dir) that mods overlay into. Empty
-- = install root. Handles games whose files live in a wrapper folder.
ALTER TABLE "Game" ADD COLUMN "modRoot" TEXT NOT NULL DEFAULT '';

-- launchOverride: for a mod, the executable to launch (relative to the base
-- game's install dir) while the mod is installed. Null = no launch change.
ALTER TABLE "Game" ADD COLUMN "launchOverride" TEXT;
