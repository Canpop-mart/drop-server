/**
 * Shared launch/setup resolution for version imports.
 *
 * Extracted from the mass-import endpoint so single-import, mass-import
 * and dry-run all derive launches the same way from a preload result
 * (the auto-discovered executables returned by
 * `libraryManager.fetchUnimportedVersionInformation`).
 */

import type { Platform } from "~/prisma/client/enums";
import type { VersionGuess } from "../index";
import type { ResolvedLaunch, ResolvedSetup } from "./types";

export interface PickedLaunches {
  launches: ResolvedLaunch[];
  setups: ResolvedSetup[];
}

/**
 * Picks launches + setups from a preload list.
 *
 * - `setupMode` true  → a single setup entry from the best guess.
 * - `setupMode` false → one launch per unique platform (so a game with
 *   Windows + Linux emulators gets both), falling back to the first
 *   guess if nothing matched.
 *
 * Returns empty arrays when `preload` is empty — callers decide whether
 * that's an error.
 */
export function pickLaunchesFromPreload(
  preload: VersionGuess[],
  setupMode: boolean,
): PickedLaunches {
  const launches: ResolvedLaunch[] = [];
  const setups: ResolvedSetup[] = [];

  if (preload.length === 0) return { launches, setups };

  if (setupMode) {
    const chosen = preload[0];
    setups.push({ platform: chosen.platform, launch: chosen.filename });
    return { launches, setups };
  }

  const pushGuess = (guess: VersionGuess) => {
    if (guess.type === "emulator") {
      launches.push({
        platform: guess.platform,
        launch: guess.filename,
        name: guess.launchName,
        emulatorId: guess.emulatorId,
      });
    } else {
      launches.push({
        platform: guess.platform,
        launch: guess.filename,
        name: "Play",
      });
    }
  };

  const seenPlatforms = new Set<Platform>();
  for (const guess of preload) {
    if (seenPlatforms.has(guess.platform)) continue;
    seenPlatforms.add(guess.platform);
    pushGuess(guess);
  }

  // Fallback: nothing matched a platform — use the first preload entry.
  if (launches.length === 0) pushGuess(preload[0]);

  return { launches, setups };
}
