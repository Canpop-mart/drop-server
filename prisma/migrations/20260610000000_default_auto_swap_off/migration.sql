-- Default Library.autoSwapSteamApiDll to false (the GBE steam_api DLL swap is
-- now opt-in). Most Drop libraries hold pre-cracked games — OnlineFix, CODEX,
-- EMPRESS, CreamAPI, etc. — that ship their own Steam emulation, so swapping
-- in a GBE DLL is redundant and can brick the working crack. New libraries
-- therefore default OFF; existing libraries keep their stored value, so this
-- is a default-only change with no in-place data migration. Flip an existing
-- library in admin → Library → Sources if you want the swap off there too.
ALTER TABLE "Library" ALTER COLUMN "autoSwapSteamApiDll" SET DEFAULT false;
