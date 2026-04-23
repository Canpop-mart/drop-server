/**
 * The Library Manager keeps track of games in Drop's library and their various states.
 * It uses path relative to the library, so it can moved without issue
 *
 * It also provides the endpoints with information about unmatched games
 */

import path from "path";
import prisma from "../db/database";
import { fuzzy } from "fast-fuzzy";
import type { TaskRunContext } from "../tasks";
import taskHandler from "../tasks";
import notificationSystem from "../notifications";
import { GameNotFoundError, type LibraryProvider } from "./provider";
import { logger } from "../logging";
import type { GameModel } from "~/prisma/client/models";
import { createHash } from "node:crypto";
import type { WorkingLibrarySource } from "~/server/api/v1/admin/library/sources/index.get";
import gameSizeManager from "~/server/internal/gamesize";
import { setupGoldberg } from "~/server/internal/goldberg";
import type { ImportVersion } from "~/server/api/v1/admin/import/version/index.post";
import { GameType, type Platform } from "~/prisma/client/enums";
import { castManifest } from "./manifest/utils";
import { dropletInterface } from "../services/torrential/droplet-interface";
import fs from "fs";
import { Shescape } from "shescape";
import type {
  Prisma,
  Game,
  Library,
  GameVersion,
  UnimportedGameVersion,
} from "~/prisma/client/client";

/** Regex to detect multi-disc folder names like "Game (Disc 1)" or "Game (Disc 2) (Rev 1)" */
const DISC_REGEX = /^(.+?)\s*\(Disc\s+(\d+)\)(.*)$/i;

export interface DiscGroup {
  /** Canonical game name without disc suffix */
  baseName: string;
  /** Ordered list of original folder names, sorted by disc number */
  folders: string[];
}

/**
 * Groups folder names by their base game name, detecting (Disc N) patterns.
 * Returns a map of base name → DiscGroup for multi-disc games, plus a list
 * of ungrouped (single-disc) folder names.
 */
export function groupDiscFolders(folders: string[]): {
  groups: Map<string, DiscGroup>;
  singles: string[];
} {
  const discEntries: { baseName: string; discNum: number; folder: string }[] =
    [];
  const singles: string[] = [];

  for (const folder of folders) {
    const match = DISC_REGEX.exec(folder);
    if (match) {
      const baseName = match[1].trim();
      const discNum = parseInt(match[2], 10);
      discEntries.push({ baseName, discNum, folder });
    } else {
      singles.push(folder);
    }
  }

  // Group by base name
  const byBase = new Map<
    string,
    { baseName: string; discNum: number; folder: string }[]
  >();
  for (const entry of discEntries) {
    const key = entry.baseName.toLowerCase();
    if (!byBase.has(key)) byBase.set(key, []);
    byBase.get(key)!.push(entry);
  }

  const groups = new Map<string, DiscGroup>();
  for (const [key, entries] of byBase) {
    if (entries.length < 2) {
      // Only one disc — treat as a normal single game
      singles.push(entries[0].folder);
      continue;
    }
    // Sort by disc number
    entries.sort((a, b) => a.discNum - b.discNum);
    groups.set(key, {
      baseName: entries[0].baseName,
      folders: entries.map((e) => e.folder),
    });
  }

  return { groups, singles };
}

export function createGameImportTaskId(libraryId: string, libraryPath: string) {
  return createHash("md5")
    .update(`import:${libraryId}:${libraryPath}`)
    .digest("hex");
}

export function createVersionImportTaskKey(
  gameId: string,
  versionName: string,
) {
  return createHash("md5")
    .update(`import:${gameId}:${versionName}`)
    .digest("hex");
}

export interface EmulatorVersionGuess {
  type: "emulator";
  emulatorId: string;
  icon: string;
  gameName: string;
  versionName: string;
  launchName: string;
  platform: Platform;
}
export interface PlatformVersionGuess {
  platform: Platform;
  type: "platform";
}
export type VersionGuess = {
  filename: string;
  match: number;
} & (PlatformVersionGuess | EmulatorVersionGuess);

export interface UnimportedVersionInformation {
  type: "local" | "depot";
  name: string;
  identifier: string;
}

class LibraryManager {
  private libraries: Map<string, LibraryProvider<unknown>> = new Map();
  private shescape = new Shescape({});

  addLibrary(library: LibraryProvider<unknown>) {
    this.libraries.set(library.id(), library);
  }

  removeLibrary(id: string) {
    this.libraries.delete(id);
  }

  getLibrary(libraryId: string): LibraryProvider<unknown> | undefined {
    return this.libraries.get(libraryId);
  }

  async fetchLibraries(): Promise<WorkingLibrarySource[]> {
    const libraries = await prisma.library.findMany({});

    const libraryWithMetadata = libraries.map(async (library) => {
      const theLibrary = this.libraries.get(library.id);
      const working = this.libraries.has(library.id);
      return {
        ...library,
        working,
        fsStats: working ? theLibrary?.fsStats() : undefined,
      };
    });
    return await Promise.all(libraryWithMetadata);
  }

  async fetchGamesByLibrary() {
    const results: { [key: string]: { [key: string]: GameModel } } = {};
    const games = await prisma.game.findMany({});
    for (const game of games) {
      const libraryId = game.libraryId!;
      const libraryPath = game.libraryPath!;

      results[libraryId] ??= {};
      results[libraryId][libraryPath] = game;
    }

    return results;
  }

  async fetchUnimportedGames() {
    const unimportedGames: { [key: string]: string[] } = {};
    const discGroups: {
      [libraryId: string]: { [baseName: string]: DiscGroup };
    } = {};
    const instanceGames = await this.fetchGamesByLibrary();

    // Build a set of disc folder names that belong to already-imported games
    // so we can exclude them from the unimported list.
    const importedDiscFolders: { [libraryId: string]: Set<string> } = {};
    for (const [libId, games] of Object.entries(instanceGames)) {
      for (const game of Object.values(games)) {
        if (game.discFolders && game.discFolders.length > 0) {
          importedDiscFolders[libId] ??= new Set();
          for (const folder of game.discFolders) {
            importedDiscFolders[libId].add(folder);
          }
        }
      }
    }

    for (const [id, library] of this.libraries.entries()) {
      const providerGames = await library.listGames();
      const providerUnimportedGames = providerGames.filter(
        (libraryPath) =>
          !instanceGames[id]?.[libraryPath] &&
          !importedDiscFolders[id]?.has(libraryPath) &&
          !taskHandler.hasTaskKey(createGameImportTaskId(id, libraryPath)),
      );

      // Detect multi-disc groups among unimported games.
      // Grouped discs are returned under their base name instead of as
      // individual disc folders, so "Xenogears (Disc 1)" and "(Disc 2)"
      // appear as a single "Xenogears" entry.
      const { groups, singles } = groupDiscFolders(providerUnimportedGames);

      const gameNames = [...singles];
      if (groups.size > 0) {
        discGroups[id] = {};
        for (const [, group] of groups) {
          gameNames.push(group.baseName);
          discGroups[id][group.baseName] = group;
        }
      }

      unimportedGames[id] = gameNames;
    }

    return { unimportedGames, discGroups };
  }

  async fetchUnimportedGameVersions(
    libraryId: string,
    libraryPath: string,
    noFetchParams?: {
      gameId: string;
      versions: string[];
      depotVersions: { id: string; versionName: string }[];
      discFolders?: string[];
    },
  ): Promise<UnimportedVersionInformation[] | undefined> {
    const provider = this.libraries.get(libraryId);
    if (!provider) return undefined;
    let params = noFetchParams;
    if (!params) {
      const game = await prisma.game.findUnique({
        where: {
          libraryKey: {
            libraryId,
            libraryPath,
          },
        },
        select: {
          id: true,
          discFolders: true,
          versions: {
            select: {
              versionPath: true,
            },
          },
        },
      });
      if (!game) return undefined;
      const depotVersions = await prisma.unimportedGameVersion.findMany({
        where: {
          gameId: game.id,
        },
        select: {
          versionName: true,
          id: true,
        },
      });

      params = {
        gameId: game.id,
        versions: game.versions
          .map((v) => v.versionPath)
          .filter((v) => v !== null),
        depotVersions: depotVersions,
      };
    }

    // For multi-disc games, the libraryPath is the baseName (e.g. "Xenogears")
    // which doesn't exist as an actual folder. Use the first disc folder instead
    // to check for versions.
    let effectivePath = libraryPath;
    if (noFetchParams?.discFolders && noFetchParams.discFolders.length > 0) {
      // Caller already provided discFolders (e.g. fetchGamesWithStatus batch)
      effectivePath = noFetchParams.discFolders[0];
    } else {
      const gameRecord = noFetchParams
        ? await prisma.game.findUnique({
            where: { id: params.gameId },
            select: { discFolders: true },
          })
        : await prisma.game.findUnique({
            where: { libraryKey: { libraryId, libraryPath } },
            select: { discFolders: true },
          });
      if (gameRecord?.discFolders && gameRecord.discFolders.length > 0) {
        effectivePath = gameRecord.discFolders[0];
      }
    }

    try {
      const versions = await provider.listVersions(
        effectivePath,
        params.versions,
      );
      const unimportedVersions = versions
        .filter(
          (e) =>
            params.versions.findIndex((v) => v == e) == -1 &&
            !taskHandler.hasTaskKey(
              createVersionImportTaskKey(params.gameId, e),
            ),
        )
        .map(
          (v) =>
            ({
              type: "local",
              name: v,
              identifier: v,
            }) satisfies UnimportedVersionInformation,
        );
      const mappedDepotVersions = params.depotVersions.map(
        (v) =>
          ({
            type: "depot",
            name: v.versionName,
            identifier: v.id,
          }) satisfies UnimportedVersionInformation,
      );
      return [...unimportedVersions, ...mappedDepotVersions];
    } catch (e) {
      if (e instanceof GameNotFoundError) {
        logger.warn(e);
        return undefined;
      }
      throw e;
    }
  }

  async fetchGamesWithStatus(
    where: Partial<Omit<Prisma.GameFindManyArgs, "include">>,
  ): Promise<
    Array<{
      game: Game & {
        library: Library;
        versions: GameVersion[];
        unimportedGameVersions: UnimportedGameVersion[];
      };
      status:
        | {
            noVersions: boolean;
            unimportedVersions: UnimportedVersionInformation[];
          }
        | "offline";
    }>
  > {
    // Fetch games without relations to avoid Prisma lateral join performance issue
    const games = await prisma.game.findMany({
      ...where,
    });

    if (games.length === 0) return [];

    const gameIds = games.map((g) => g.id);
    const libraryIds = [
      ...new Set(games.map((g) => g.libraryId).filter(Boolean)),
    ] as string[];

    // Fetch relations separately using IN clauses
    const [libraries, versions, unimportedGameVersions] = await Promise.all([
      prisma.library.findMany({ where: { id: { in: libraryIds } } }),
      prisma.gameVersion.findMany({ where: { gameId: { in: gameIds } } }),
      prisma.unimportedGameVersion.findMany({
        where: { gameId: { in: gameIds } },
      }),
    ]);

    // Index by ID/gameId for fast lookup
    const libraryMap = new Map(libraries.map((l) => [l.id, l]));
    const versionMap = new Map<string, typeof versions>();
    for (const v of versions) {
      const arr = versionMap.get(v.gameId) ?? [];
      arr.push(v);
      versionMap.set(v.gameId, arr);
    }
    const unimportedMap = new Map<string, typeof unimportedGameVersions>();
    for (const u of unimportedGameVersions) {
      const arr = unimportedMap.get(u.gameId) ?? [];
      arr.push(u);
      unimportedMap.set(u.gameId, arr);
    }

    // Stitch together and compute status
    return await Promise.all(
      games.map(async (e) => {
        const gameVersions = versionMap.get(e.id) ?? [];
        const gameUnimported = unimportedMap.get(e.id) ?? [];
        const library = libraryMap.get(e.libraryId)!;

        const gameWithRelations = {
          ...e,
          library,
          versions: gameVersions,
          unimportedGameVersions: gameUnimported,
        };

        const unimportedVersions = await this.fetchUnimportedGameVersions(
          e.libraryId ?? "",
          e.libraryPath,
          {
            gameId: e.id,
            versions: gameVersions
              .map((v) => v.versionPath)
              .filter((v) => v !== null),
            depotVersions: gameUnimported,
            discFolders: e.discFolders,
          },
        );
        return {
          game: gameWithRelations,
          status: unimportedVersions
            ? {
                noVersions: gameVersions.length == 0,
                unimportedVersions: unimportedVersions,
              }
            : ("offline" as const),
        };
      }),
    );
  }

  /**
   * Fetches recommendations and extra data about the version. Doesn't actually check if it's been imported.
   * @param gameId
   * @param versionIdentifier
   * @returns
   */
  async fetchUnimportedVersionInformation(
    gameId: string,
    versionIdentifier: Omit<UnimportedVersionInformation, "name">,
  ) {
    const game = await prisma.game.findUnique({
      where: { id: gameId },
      select: { libraryPath: true, libraryId: true, mName: true },
    });
    if (!game || !game.libraryId) return undefined;

    const library = this.libraries.get(game.libraryId);
    if (!library) return undefined;

    const fileExts: { [key in Platform]: string[] } = {
      Linux: [
        // Ext for Unity games
        ".x86_64",
        // Shell scripts
        ".sh",
        // No extension is common for Linux binaries
        "",
        // AppImages
        ".appimage",
      ],
      Windows: [".exe", ".bat"],
      macOS: [
        // App files
        ".app",
      ],
    };

    const emulators = await prisma.launchConfiguration.findMany({
      where: {
        emulatorSuggestions: {
          isEmpty: false,
        },
        gameVersion: {
          game: {
            type: GameType.Emulator,
          },
        },
      },
      select: {
        emulatorSuggestions: true,
        gameVersion: {
          select: {
            game: {
              select: {
                mIconObjectId: true,
                mName: true,
              },
            },
            displayName: true,
            versionPath: true,
          },
        },
        name: true,
        launchId: true,
        platform: true,
      },
    });

    const options: Array<VersionGuess> = [];

    // For multi-disc games, read the game's discFolders to know which
    // physical folders to scan for ROM files.
    const gameRecord = await prisma.game.findUnique({
      where: { id: gameId },
      select: { discFolders: true },
    });
    const discFolders = gameRecord?.discFolders ?? [];

    let files;
    if (versionIdentifier.type === "local") {
      if (discFolders.length > 1) {
        // Multi-disc: scan files from each disc folder, prefixing each
        // file with the disc folder name so we can resolve disc paths later.
        const allFiles: string[] = [];
        for (const folder of discFolders) {
          try {
            const folderFiles = await library.versionReaddir(
              folder,
              versionIdentifier.identifier,
            );
            allFiles.push(...folderFiles.map((f) => path.join(folder, f)));
          } catch {
            // Disc folder might not exist as a valid game dir — skip
          }
        }
        files = allFiles;
      } else {
        files = await library.versionReaddir(
          game.libraryPath,
          versionIdentifier.identifier,
        );
      }
    } else if (versionIdentifier.type === "depot") {
      const unimported = await prisma.unimportedGameVersion.findUnique({
        where: {
          id: versionIdentifier.identifier,
        },
        select: {
          fileList: true,
        },
      });
      if (!unimported) return undefined;
      files = unimported.fileList;
    } else {
      return undefined;
    }

    for (const filename of files) {
      const basename = path.basename(filename);
      const dotLocation = filename.lastIndexOf(".");
      const ext =
        dotLocation == -1 ? "" : filename.slice(dotLocation).toLowerCase();
      for (const [platform, checkExts] of Object.entries(fileExts)) {
        for (const checkExt of checkExts) {
          if (checkExt != ext) continue;
          const fuzzyValue = fuzzy(basename, game.mName);
          options.push({
            type: "platform",
            filename: this.shescape.escape(filename),
            platform: platform as Platform,
            match: fuzzyValue,
          });
        }
      }
      for (const emulator of emulators) {
        for (const suggestion of emulator.emulatorSuggestions) {
          if (suggestion != ext) continue;
          const fuzzyValue = fuzzy(basename, game.mName);
          options.push({
            type: "emulator",
            filename: this.shescape.escape(filename),
            match: fuzzyValue,
            emulatorId: emulator.launchId,

            icon: emulator.gameVersion.game.mIconObjectId,
            gameName: emulator.gameVersion.game.mName,
            versionName: (emulator.gameVersion.displayName ??
              emulator.gameVersion.versionPath)!,
            launchName: emulator.name,
            platform: emulator.platform,
          });
        }
      }
    }

    const sortedOptions = options.sort((a, b) => b.match - a.match);

    return sortedOptions;
  }

  // Checks are done in least to most expensive order
  async checkUnimportedGamePath(libraryId: string, libraryPath: string) {
    const hasGame =
      (await prisma.game.count({
        where: { libraryId, libraryPath },
      })) > 0;
    if (hasGame) return false;

    // For disc groups the libraryPath is the base name (e.g. "Xenogears (USA)")
    // which may not exist as an actual folder. Validate either the folder exists
    // OR it matches a disc group discovered by fetchUnimportedGames.
    const library = this.libraries.get(libraryId);
    if (!library) return false;
    const allFolders = await library.listGames();
    if (allFolders.includes(libraryPath)) return true;

    // Check if libraryPath matches a disc group base name
    const { groups } = groupDiscFolders(allFolders);
    for (const [, group] of groups) {
      if (group.baseName === libraryPath) return true;
    }

    return false;
  }

  /*
  Game creation happens in metadata, because it's primarily a metadata object

  async createGame(libraryId: string, libraryPath: string, game: Omit<Game, "libraryId" | "libraryPath">) {

  }
  */

  async importVersion(
    gameId: string,
    version: UnimportedVersionInformation,
    metadata: typeof ImportVersion.infer,
    parentTask?: TaskRunContext,
  ) {
    const taskKey = createVersionImportTaskKey(gameId, version.identifier);

    if (metadata.delta) {
      for (const platformObject of [
        ...metadata.launches,
        ...metadata.setups,
      ].filter(
        (v, i, a) => a.findIndex((k) => k.platform === v.platform) == i,
      )) {
        const validOverlayVersions = await prisma.gameVersion.count({
          where: {
            gameId: metadata.id,
            delta: false,
            OR: [
              { launches: { some: { platform: platformObject.platform } } },
              {
                setups: { some: { platform: platformObject.platform } },
              },
            ],
          },
        });
        if (validOverlayVersions == 0)
          throw createError({
            statusCode: 400,
            message: `Update mode requires a pre-existing version for platform: ${platformObject.platform}`,
          });
      }
    }

    if (metadata.onlySetup) {
      if (metadata.setups.length == 0)
        throw createError({
          statusCode: 400,
          message: 'Setup required in "setup mode".',
        });
    } else {
      if (metadata.launches.length == 0)
        throw createError({
          statusCode: 400,
          message: "Launch executable is required.",
        });
    }

    const game = await prisma.game.findUnique({
      where: { id: gameId },
      select: {
        mName: true,
        libraryId: true,
        libraryPath: true,
        type: true,
        discFolders: true,
      },
    });
    if (!game || !game.libraryId) return undefined;

    // For multi-disc games, libraryPath is an abstract base name that doesn't
    // exist on disk. The actual directories are in discFolders[].
    const isMultiDisc = game.discFolders && game.discFolders.length > 1;
    const effectiveLibraryPath = isMultiDisc
      ? game.discFolders![0]
      : game.libraryPath;

    if (game.type === GameType.Dependency && !metadata.onlySetup)
      throw createError({
        statusCode: 400,
        message: "Dependencies can only be in setup-only mode.",
      });

    const library = this.libraries.get(game.libraryId);
    if (!library) return undefined;

    const unimportedVersion =
      version.type === "depot"
        ? await prisma.unimportedGameVersion.findUnique({
            where: { id: version.identifier },
          })
        : undefined;

    return await taskHandler.create(
      {
        key: taskKey,
        taskGroup: "import:version",
        name: `Importing version ${version.name} for ${game.mName}`,
        acls: ["system:import:version:read"],
        async run({ progress, logger }) {
          let versionPath: string | null = null;
          let manifest;
          let fileList;

          if (version.type === "local") {
            versionPath = version.identifier;

            // Auto-upgrade SSE → GBE and set up Goldberg BEFORE manifest
            // generation so all emulator config files (achievements.json,
            // steam_appid.txt, drop-goldberg/<AppID>/) are included in the
            // manifest and downloaded by clients.
            try {
              const versionDir = library.resolveVersionDir(
                effectiveLibraryPath,
                versionPath,
              );
              if (versionDir) {
                const { autoUpgradeSseIfNeeded, autoUpgradeSteamDrmIfNeeded } =
                  await import("~/server/internal/gbe");

                // Pass 1: SSE (cracked) games → GBE. DLL swap triggers when
                // steam_emu.ini is adjacent to the Steam API DLL.
                await autoUpgradeSseIfNeeded(versionDir, gameId, logger);

                // Pass 2: Legitimate Steam DRM → GBE. Triggers when
                // steamclient64.dll / gameoverlayrenderer64.dll markers are
                // present AND we have a Steam AppID from metadata. Skipped
                // if pass 1 already wrote steam_settings/ next to the DLL.
                const steamMeta = await prisma.game.findUnique({
                  where: { id: gameId },
                  select: { metadataSource: true, metadataId: true },
                });
                const steamAppId =
                  steamMeta?.metadataSource === "Steam"
                    ? (steamMeta.metadataId ?? undefined)
                    : undefined;
                await autoUpgradeSteamDrmIfNeeded(
                  versionDir,
                  gameId,
                  steamAppId,
                  logger,
                );

                await setupGoldberg(gameId, versionDir);
              }
            } catch (e) {
              logger.warn(
                `Pre-manifest emulator setup failed (non-critical): ${e}`,
              );
            }

            // First, create the manifest via droplet.
            // This takes up 90% of our progress, so we wrap it in a *0.9

            if (isMultiDisc) {
              // Multi-disc: create a persistent directory with symlinks to each
              // disc folder. This directory is kept permanently so that the
              // download/serve system (torrential) can resolve the path when
              // clients request the version. The game's libraryPath is updated
              // to point here.
              const baseDir = library.resolveVersionDir(
                game.discFolders![0],
                versionPath,
              );
              if (!baseDir)
                throw new Error(
                  `Could not resolve disc folder: ${game.discFolders![0]}`,
                );
              const libraryBase = path.dirname(baseDir);
              const multiDiscDirName = `.drop-multidisc-${gameId}`;
              const multiDiscDir = path.join(libraryBase, multiDiscDirName);

              logger.info(
                `Multi-disc game with ${game.discFolders!.length} disc(s), staging at ${multiDiscDir}`,
              );
              fs.mkdirSync(multiDiscDir, { recursive: true });

              // Create symlinks for each disc folder inside the combined dir
              for (const folder of game.discFolders!) {
                const src = path.join(libraryBase, folder);
                const dest = path.join(multiDiscDir, folder);
                if (!fs.existsSync(dest) && fs.existsSync(src)) {
                  fs.symlinkSync(src, dest, "junction");
                  logger.info(`Linked disc folder: ${folder}`);
                }
              }

              // Generate a single manifest from the combined dir
              manifest = await dropletInterface.generateDropletManifest(
                multiDiscDir,
                (value) => progress(value * 0.9),
                (value) => logger.info(value),
              );
              fileList = await dropletInterface.listFiles(multiDiscDir);

              // Update the game's libraryPath so torrential can find the files
              await prisma.game.updateMany({
                where: { id: gameId },
                data: { libraryPath: multiDiscDirName },
              });
              logger.info(
                `Updated libraryPath to ${multiDiscDirName} for multi-disc serving`,
              );
            } else {
              manifest = await library.generateDropletManifest(
                effectiveLibraryPath,
                versionPath,
                (value) => {
                  progress(value * 0.9);
                },
                (value) => {
                  logger.info(value);
                },
              );
              fileList = await library.versionReaddir(
                effectiveLibraryPath,
                versionPath,
              );
            }
            logger.info("Created manifest successfully!");
          } else if (version.type === "depot" && unimportedVersion) {
            manifest = castManifest(unimportedVersion.manifest);
            fileList = unimportedVersion.fileList;
            progress(90);
          } else {
            throw "Could not find or create manifest for this version.";
          }

          const largestIndex = await prisma.gameVersion.findFirst({
            where: { gameId: gameId },
            orderBy: {
              versionIndex: "desc",
            },
            select: {
              versionIndex: true,
            },
          });
          const currentIndex = largestIndex ? largestIndex.versionIndex + 1 : 0;

          // Then, create the database object
          const newVersion = await prisma.gameVersion.create({
            data: {
              game: {
                connect: {
                  id: gameId,
                },
              },

              displayName: metadata.displayName ?? versionPath ?? null,

              versionPath,
              dropletManifest: manifest,
              fileList,
              versionIndex: currentIndex,
              delta: metadata.delta,

              onlySetup: metadata.onlySetup,
              setups: {
                createMany: {
                  data: metadata.setups.map((v) => ({
                    command: v.launch,
                    platform: v.platform,
                  })),
                },
              },

              launches: {
                createMany: !metadata.onlySetup
                  ? {
                      data: metadata.launches.map((v) => ({
                        name: v.name,
                        command: v.launch,
                        platform: v.platform,
                        ...(v.emulatorId && game.type === "Game"
                          ? {
                              emulatorId: v.emulatorId,
                            }
                          : undefined),
                        emulatorSuggestions:
                          game.type === "Emulator" ? (v.suggestions ?? []) : [],
                        discPaths: v.discPaths ?? [],
                      })),
                    }
                  : { data: [] },
              },
            },
          });
          logger.info("Successfully created version!");

          // Clear the update-available flag now that a new version is installed
          await prisma.game.updateMany({
            where: { id: gameId },
            data: { updateAvailable: false },
          });

          // NOTE: setupGoldberg() now runs BEFORE manifest generation (above)
          // so that all emulator files are included in the download.

          notificationSystem.systemPush({
            nonce: `version-create-${gameId}-${version}`,
            title: `'${game.mName}' ('${version.name}') finished importing.`,
            description: `Drop finished importing version ${version.name} for ${game.mName}.`,
            actions: [`View|/admin/library/${gameId}`],
            acls: ["system:import:version:read"],
          });

          // Ensure cache is filled (also pre-caches the manifest)
          try {
            await gameSizeManager.getVersionSize(newVersion.versionId);
          } catch (e) {
            logger.warn(`Failed to pre-cache game size and manifest: ${e}`);
          }

          if (version.type === "depot") {
            // SAFETY: we can only reach this if the type is depot and identifier is valid
            // eslint-disable-next-line drop/no-prisma-delete
            await prisma.unimportedGameVersion.delete({
              where: {
                id: version.identifier,
              },
            });
          }
          progress(100);
        },
      },
      parentTask,
    );
  }

  async peekFile(
    libraryId: string,
    game: string,
    version: string,
    filename: string,
  ) {
    const library = this.libraries.get(libraryId);
    if (!library) return undefined;
    return await library.peekFile(game, version, filename);
  }

  async deleteGameVersion(gameId: string, version: string) {
    await prisma.gameVersion.deleteMany({
      where: {
        gameId: gameId,
        versionId: version,
      },
    });
  }

  async deleteGame(gameId: string) {
    await prisma.game.deleteMany({
      where: {
        id: gameId,
      },
    });
    // Delete all game versions that depended on this game
    await prisma.gameVersion.deleteMany({
      where: {
        launches: {
          some: {
            emulator: {
              gameVersion: {
                gameId,
              },
            },
          },
        },
      },
    });
  }

  /**
   * Regenerates the droplet manifest + file list for a game's latest
   * version and persists them. Needed after any server-side mutation of
   * the on-disk files (e.g. admin-triggered GBE DLL swap) so the depot's
   * download checksums match what's actually on disk.
   *
   * Multi-disc games are currently not supported — the staging symlink
   * tree would need re-validation; callers should re-import instead.
   *
   * Returns true on success, false if the regen was skipped or failed
   * (check the logger for details).
   */
  async regenerateManifestForLatestVersion(
    gameId: string,
    taskLogger: { info: (msg: string) => void; warn: (msg: string) => void },
  ): Promise<boolean> {
    const game = await prisma.game.findUnique({
      where: { id: gameId },
      select: {
        mName: true,
        libraryId: true,
        libraryPath: true,
        discFolders: true,
        versions: {
          orderBy: { versionIndex: "desc" },
          take: 1,
          select: { versionId: true, versionPath: true },
        },
      },
    });

    if (!game || !game.libraryId) {
      taskLogger.warn(
        `Manifest regen: game ${gameId} not found or has no libraryId`,
      );
      return false;
    }

    if (game.versions.length === 0) {
      taskLogger.warn(`Manifest regen: ${game.mName} has no versions`);
      return false;
    }

    const library = this.libraries.get(game.libraryId);
    if (!library) {
      taskLogger.warn(
        `Manifest regen: library ${game.libraryId} not loaded — server restart may be needed`,
      );
      return false;
    }

    const version = game.versions[0];
    if (!version.versionPath) {
      taskLogger.warn(
        `Manifest regen: latest version of ${game.mName} has no versionPath`,
      );
      return false;
    }

    const isMultiDisc = game.discFolders && game.discFolders.length > 1;
    if (isMultiDisc) {
      taskLogger.warn(
        `Manifest regen: ${game.mName} is multi-disc — not supported, please re-import manually`,
      );
      return false;
    }

    taskLogger.info(
      `Regenerating manifest for ${game.mName} (version ${version.versionPath})...`,
    );

    try {
      const manifest = await library.generateDropletManifest(
        game.libraryPath,
        version.versionPath,
        () => {
          /* no progress reporting from admin-task context */
        },
        (msg) => taskLogger.info(msg),
      );
      const fileList = await library.versionReaddir(
        game.libraryPath,
        version.versionPath,
      );

      const res = await prisma.gameVersion.updateMany({
        where: { versionId: version.versionId },
        data: {
          dropletManifest: manifest,
          fileList,
        },
      });
      if (res.count === 0) {
        taskLogger.warn(
          `Manifest regen: version ${version.versionId} was not found at update time`,
        );
        return false;
      }

      taskLogger.info(`Manifest regenerated for ${game.mName}`);
      return true;
    } catch (e) {
      taskLogger.warn(`Manifest regen failed for ${game.mName}: ${e}`);
      return false;
    }
  }
}

export const libraryManager = new LibraryManager();
export default libraryManager;
