-- Add per-library and per-game opt-out for the GBE steam_api DLL auto-swap.
-- See server/internal/gbe.ts (ensureGbeDll) for swap-decision details.

-- Library: default ON, matches the historical behaviour from before this
-- flag existed (the swap ran on every import regardless of crack status).
ALTER TABLE "Library"
    ADD COLUMN "autoSwapSteamApiDll" BOOLEAN NOT NULL DEFAULT true;

-- Game: nullable so a missing value means "inherit the library setting".
-- Set explicitly to TRUE / FALSE to override the library default for a
-- single game (typical case: a pre-fixed game inside a library that
-- otherwise has the swap enabled).
ALTER TABLE "Game"
    ADD COLUMN "autoSwapSteamApiDll" BOOLEAN;
