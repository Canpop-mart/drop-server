-- Remove the GBE steam_api DLL auto-swap feature.
--
-- Drop no longer swaps a game's steam_api DLL: games ship with whatever Steam
-- emulator they need (GBE for offline, OnlineFix for online), and a game
-- uploaded without one is the uploader's responsibility. The per-game and
-- per-library auto-swap override columns are no longer read by any code path,
-- so they're dropped. `Library.autoEmulatorSetup` is retained — it gates the
-- achievement/steam_settings phase, which stays.

ALTER TABLE "Game" DROP COLUMN "autoSwapSteamApiDll";
ALTER TABLE "Library" DROP COLUMN "autoSwapSteamApiDll";
