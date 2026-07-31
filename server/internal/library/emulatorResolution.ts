/**
 * Version-resilient ROM to emulator resolution.
 *
 * A ROM declares the emulator it needs by pointing its launch config at a
 * specific emulator *launch config* (`LaunchConfiguration.emulatorId` -> the
 * emulator's `launchId`). That launch config is version-scoped: it is
 * cascade-deleted with the emulator's `GameVersion`. Because Drop versions are
 * immutable, adding a core to an emulator publishes a NEW emulator version and
 * drops the old one, and the `emulatorId` FK is `ON DELETE SET NULL` — so the
 * ROM's `emulatorId` is wiped the moment the emulator is re-versioned. Every ROM
 * on that emulator is then orphaned: the client (which resolves + downloads the
 * emulator strictly by the pinned version) shows no required emulator and can't
 * launch.
 *
 * This resolver heals that at read time, with no schema migration and no admin
 * re-linking:
 *   - Intact link -> resolve the emulator GAME's LATEST version, never the
 *     pinned one, so a ROM always points at the current emulator (+ new cores).
 *   - Wiped link  -> re-derive the emulator from the ROM file's extension
 *     against emulators' `emulatorSuggestions` (the same signal the importer
 *     matched on), but only when exactly one emulator claims that extension, so
 *     an ambiguous extension is never guessed wrong.
 *
 * It returns a `{ launchId, gameId, versionId }` triple drawn from the same
 * (current) emulator version, so the client's `version_id` lookup and its
 * `launch_id` lookup within that version both resolve. Never throws: any failure
 * resolves to null, leaving the ROM unlinked exactly as before the fix.
 */

import path from "path";
import prisma from "../db/database";
import { GameType } from "~/prisma/client/enums";
import type { Platform } from "~/prisma/client/enums";

export interface ResolvedEmulator {
  /** Launch config id WITHIN the emulator's current version. */
  launchId: string;
  /** The emulator GAME id (stable across version churn). */
  gameId: string;
  /** The emulator's CURRENT version id. */
  versionId: string;
  /** Emulator display metadata, for the install dialog dependency card. */
  game: {
    mName: string;
    mShortDescription: string;
    mIconObjectId: string;
  };
}

export interface EmulatorResolveInput {
  /** Platform of the ROM's launch config. */
  platform: Platform;
  /** The ROM launch command (the shell-escaped path to the ROM file). */
  command: string;
  /** Emulator GAME id from an intact link, or null when the link was wiped. */
  emulatorGameId: string | null;
  /**
   * Name of the pinned emulator launch config, used to keep the same launch
   * when the emulator's latest version exposes several. Optional; ignored when
   * the pinned launch is gone (the re-version case).
   */
  emulatorLaunchName?: string | null;
}

interface EmulatorLaunchRow {
  launchId: string;
  platform: Platform;
  name: string;
  emulatorSuggestions: string[];
}

interface LatestEmulatorVersion {
  versionId: string;
  gameId: string;
  game: {
    mName: string;
    mShortDescription: string;
    mIconObjectId: string;
  };
  launches: EmulatorLaunchRow[];
}

/**
 * Read the ROM file's extension from a launch command. Import stores commands
 * shell-escaped (shescape); strip any wrapping quotes and undo the backslash
 * escapes, then take the extension. Lower-cased, dot-prefixed (".z64"), to
 * match how `emulatorSuggestions` are stored.
 */
function romExtension(command: string): string {
  let s = command.trim();
  if (
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith("'") && s.endsWith("'"))
  ) {
    s = s.slice(1, -1);
  }
  s = s.replace(/\\(.)/g, "$1");
  return path.extname(s).toLowerCase();
}

/**
 * Pick the launch config in the emulator's latest version that best matches the
 * ROM launch: same platform, then (when there is still a choice) the pinned
 * launch's name or the launch that handles this ROM's extension, then any
 * same-platform launch, then the version's first launch.
 */
function pickEmulatorLaunch(
  latest: LatestEmulatorVersion,
  input: EmulatorResolveInput,
  ext: string,
): EmulatorLaunchRow | undefined {
  if (latest.launches.length === 0) return undefined;

  const samePlatform = latest.launches.filter(
    (l) => l.platform === input.platform,
  );
  const pool = samePlatform.length > 0 ? samePlatform : latest.launches;

  if (input.emulatorLaunchName) {
    const byName = pool.find((l) => l.name === input.emulatorLaunchName);
    if (byName) return byName;
  }
  if (ext) {
    const byExt = pool.find((l) =>
      l.emulatorSuggestions.some((s) => s.toLowerCase() === ext),
    );
    if (byExt) return byExt;
  }
  return pool[0];
}

/**
 * Create a request-scoped emulator resolver. Memoises per emulator game (so a
 * ROM with several versions/launches all pointing at one emulator triggers a
 * single latest-version lookup) and builds the extension re-derivation index at
 * most once per request.
 */
export function createEmulatorResolver() {
  // emulatorGameId -> latest version (null = that game has no versions).
  // Stores the promise so concurrent resolves share one query.
  const latestByGame = new Map<string, Promise<LatestEmulatorVersion | null>>();
  // Lazily-built ".ext" -> emulator gameId index for re-deriving wiped links.
  // A null value marks an ambiguous extension (2+ emulators), never auto-healed.
  let extIndexPromise: Promise<Map<string, string | null>> | null = null;

  function latestVersionFor(
    gameId: string,
  ): Promise<LatestEmulatorVersion | null> {
    let cached = latestByGame.get(gameId);
    if (!cached) {
      cached = prisma.gameVersion.findFirst({
        where: { gameId },
        orderBy: { versionIndex: "desc" },
        select: {
          versionId: true,
          gameId: true,
          game: {
            select: {
              mName: true,
              mShortDescription: true,
              mIconObjectId: true,
            },
          },
          launches: {
            select: {
              launchId: true,
              platform: true,
              name: true,
              emulatorSuggestions: true,
            },
          },
        },
      });
      latestByGame.set(gameId, cached);
    }
    return cached;
  }

  function buildExtIndex(): Promise<Map<string, string | null>> {
    if (extIndexPromise) return extIndexPromise;
    extIndexPromise = (async () => {
      const index = new Map<string, string | null>();
      const emulators = await prisma.game.findMany({
        where: { type: GameType.Emulator },
        select: {
          id: true,
          versions: {
            orderBy: { versionIndex: "desc" },
            take: 1,
            select: {
              versionId: true,
              gameId: true,
              game: {
                select: {
                  mName: true,
                  mShortDescription: true,
                  mIconObjectId: true,
                },
              },
              launches: {
                select: {
                  launchId: true,
                  platform: true,
                  name: true,
                  emulatorSuggestions: true,
                },
              },
            },
          },
        },
      });
      for (const emulator of emulators) {
        const latest = emulator.versions[0];
        if (!latest) continue;
        // Reuse the latest version if this emulator is resolved directly later.
        latestByGame.set(emulator.id, Promise.resolve(latest));
        const exts = new Set<string>();
        for (const launch of latest.launches)
          for (const suggestion of launch.emulatorSuggestions)
            exts.add(suggestion.toLowerCase());
        for (const ext of exts) {
          if (!index.has(ext)) index.set(ext, emulator.id);
          else if (index.get(ext) !== emulator.id) index.set(ext, null);
        }
      }
      return index;
    })();
    return extIndexPromise;
  }

  async function resolve(
    input: EmulatorResolveInput,
  ): Promise<ResolvedEmulator | null> {
    try {
      const ext = romExtension(input.command);
      let emulatorGameId = input.emulatorGameId;

      // Wiped link (emulatorId was SET NULL when the emulator was re-versioned):
      // re-derive the emulator from the ROM extension, unambiguous matches only.
      if (!emulatorGameId) {
        if (!ext) return null;
        const index = await buildExtIndex();
        emulatorGameId = index.get(ext) ?? null;
        if (!emulatorGameId) return null; // unknown or ambiguous extension
      }

      const latest = await latestVersionFor(emulatorGameId);
      if (!latest) return null;

      const launch = pickEmulatorLaunch(latest, input, ext);
      if (!launch) return null;

      return {
        launchId: launch.launchId,
        gameId: latest.gameId,
        versionId: latest.versionId,
        game: latest.game,
      };
    } catch {
      // Read-path safety: a resolver failure must never 500 the endpoint.
      return null;
    }
  }

  return { resolve };
}
