# Bundled gbe_fork (Goldberg) Steam-emulator binaries

Drop swaps these in at import so games get achievements + LAN/ZeroTier
matchmaking. Bundled (not downloaded) for reproducibility + offline NAS builds.

- win64/steam_api64.dll — gbe_fork x64 (experimental build)
- win32/steam_api.dll — gbe_fork x86 (experimental build)
- linux/libsteam_api.so — TODO (source for the Steam Deck target)

Source: Detanup01/gbe_fork (experimental). Validated cross-internet co-op
(Castle Crashers over ZeroTier). gbe_fork is GPLv3 — keep license/source notice.
