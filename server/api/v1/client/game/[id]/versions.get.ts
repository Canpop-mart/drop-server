import { ArkErrors, type } from "arktype";
import { GameType, LibraryBackend, Platform } from "~/prisma/client/enums";
import { defineClientEventHandler } from "~/server/internal/clients/event-handler";
import { requireRouterParam } from "~/server/arktype";
import prisma from "~/server/internal/db/database";
import type { GameVersionSize } from "~/server/internal/gamesize";
import gameSizeManager from "~/server/internal/gamesize";
import { createEmulatorResolver } from "~/server/internal/library/emulatorResolution";

type VersionDownloadOption = {
  gameId: string;
  versionId: string;
  displayName?: string | undefined;
  versionPath?: string | undefined;
  platform: Platform;
  size: GameVersionSize;
  // Mod placement (type=Mod versions): where the mod overlays + optional launch
  // override, both relative to the base game's install dir.
  modInstallDir: string;
  launchOverride: string | null;
  requiredContent: Array<{
    gameId: string;
    versionId: string;
    name: string;
    iconObjectId: string;
    shortDescription: string;
    size: GameVersionSize;
  }>;
  // Mod prerequisites: other mods this version requires (type=Mod only), enough
  // for the client to resolve + install them onto the same parent game.
  requiredMods: Array<{
    gameId: string;
    versionId: string;
    name: string;
    iconObjectId: string;
  }>;
};

const Query = type({
  previous: "string?",
});

export default defineClientEventHandler(async (h3) => {
  const id = requireRouterParam(h3, "id");
  if (!id)
    throw createError({
      statusCode: 400,
      statusMessage: "No ID in router params",
    });

  const query = Query(getQuery(h3));
  if (query instanceof ArkErrors)
    throw createError({ statusCode: 400, message: query.summary });

  const rawVersions = await prisma.gameVersion.findMany({
    where: {
      gameId: id,
    },
    orderBy: {
      versionIndex: "desc", // Latest one first
    },
    select: {
      versionId: true,
      displayName: true,
      versionPath: true,
      gameId: true,
      modInstallDir: true,
      launchOverride: true,
      launches: {
        select: {
          platform: true,
          // ROM path — used to re-derive the emulator by extension when the
          // stored emulator link was wiped (SET NULL on emulator re-version).
          command: true,
          emulator: {
            select: {
              // Only the emulator GAME id + pinned launch name are read; the
              // emulator's CURRENT version is resolved fresh (see below), never
              // the pinned one, so a re-versioned emulator does not orphan ROMs.
              name: true,
              gameVersion: {
                select: {
                  game: { select: { id: true } },
                },
              },
            },
          },
        },
      },
      setups: true,
      requiredContent: {
        select: {
          versionId: true,
          gameId: true,
          game: {
            select: { type: true, mName: true, mIconObjectId: true },
          },
        },
      },
    },
  });

  // Mods can be pure file overlays with no launch/setup configs, which would
  // otherwise yield no download option (platform is derived from those). Detect
  // a mod so we can offer such versions on every platform below.
  const game = await prisma.game.findUnique({
    where: { id },
    select: { type: true, library: { select: { backend: true } } },
  });
  const isMod = game?.type === GameType.Mod;
  // Console ROMs live in FlatFilesystem libraries; only they re-derive a wiped
  // emulator link by ROM extension, so PC games skip the emulator scan entirely.
  const isConsole = game?.library?.backend === LibraryBackend.FlatFilesystem;

  // Request-scoped: memoises emulator lookups across every version + launch.
  const emulatorResolver = createEmulatorResolver();

  const versions: Array<VersionDownloadOption> = (
    await Promise.all(
      rawVersions.map(async (v) => {
        const platformOptions: Map<
          Platform,
          VersionDownloadOption["requiredContent"]
        > = new Map();

        for (const launch of [...v.launches, ...v.setups]) {
          if (!platformOptions.has(launch.platform))
            platformOptions.set(launch.platform, []);

          // Only launches (not setups) can require an emulator.
          if (!("emulator" in launch)) continue;

          const emulatorGameId = launch.emulator?.gameVersion.game.id ?? null;
          // Nothing to resolve for a PC game; a wiped link is only worth
          // re-deriving for a console ROM.
          if (!emulatorGameId && !isConsole) continue;

          // Resolve the emulator's CURRENT version (never the pinned one), and
          // re-derive it from the ROM extension when the link was wiped.
          const resolved = await emulatorResolver.resolve({
            platform: launch.platform,
            command: launch.command,
            emulatorGameId,
            emulatorLaunchName: launch.emulator?.name ?? null,
          });
          if (!resolved) continue;

          // Skip the dependency rather than emit a broken (sizeless) entry if
          // the emulator version's size can't be computed.
          const size = await gameSizeManager.getVersionSize(resolved.versionId);
          if (!size) continue;

          platformOptions.get(launch.platform)!.push({
            gameId: resolved.gameId,
            versionId: resolved.versionId,
            name: resolved.game.mName,
            iconObjectId: resolved.game.mIconObjectId,
            shortDescription: resolved.game.mShortDescription,
            size,
          });
        }

        // A launch-less mod version is a pure overlay — offer it on every
        // platform (files are identical) so the client can pick + download it.
        if (platformOptions.size === 0 && isMod) {
          for (const platform of [
            Platform.Windows,
            Platform.Linux,
            Platform.macOS,
          ]) {
            platformOptions.set(platform, []);
          }
        }

        let size: Awaited<ReturnType<typeof gameSizeManager.getVersionSize>>;
        try {
          size = await gameSizeManager.getVersionSize(
            v.versionId,
            query.previous,
          );
        } catch {
          size = null;
        }

        // Never drop a version just because its size couldn't be computed. The
        // delta (previous set) is the slow/failure-prone path, so fall back to
        // the full download size, then to the on-disk size. A size hiccup must
        // not make an installed game report "no supported versions".
        if (!size && query.previous) {
          size = await gameSizeManager.getVersionSize(v.versionId);
        }
        if (!size) {
          const diskSize = await gameSizeManager.getVersionDiskSize(
            v.versionId,
          );
          if (diskSize != null)
            size = {
              versionId: v.versionId,
              installSize: diskSize,
              downloadSize: diskSize,
            };
        }

        // Only a version with no readable manifest at all (a broken import) is
        // genuinely not installable — the sole remaining reason to omit it.
        if (!size) return [];

        // Prerequisite mods this version needs (the requiredContent links that
        // point at type=Mod games). Same for every platform of the version.
        const requiredMods = v.requiredContent
          .filter((rc) => rc.game.type === GameType.Mod)
          .map((rc) => ({
            gameId: rc.gameId,
            versionId: rc.versionId,
            name: rc.game.mName,
            iconObjectId: rc.game.mIconObjectId,
          }));

        return platformOptions
          .entries()
          .map(
            ([platform, requiredContent]) =>
              ({
                gameId: v.gameId,
                versionId: v.versionId,
                displayName: v.displayName || undefined,
                versionPath: v.versionPath || undefined,
                platform,
                requiredContent,
                size,
                modInstallDir: v.modInstallDir,
                launchOverride: v.launchOverride,
                requiredMods,
              }) satisfies VersionDownloadOption,
          )
          .toArray();
      }),
    )
  ).flat();

  return versions;
});
