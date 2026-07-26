import { ArkErrors, type } from "arktype";
import { GameType, Platform } from "~/prisma/client/enums";
import { defineClientEventHandler } from "~/server/internal/clients/event-handler";
import { requireRouterParam } from "~/server/arktype";
import prisma from "~/server/internal/db/database";
import type { GameVersionSize } from "~/server/internal/gamesize";
import gameSizeManager from "~/server/internal/gamesize";

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
          emulator: {
            select: {
              gameVersion: {
                select: {
                  game: {
                    select: {
                      mName: true,
                      mShortDescription: true,
                      mIconObjectId: true,
                      id: true,
                    },
                  },
                  versionId: true,
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
    select: { type: true },
  });
  const isMod = game?.type === GameType.Mod;

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

          if ("emulator" in launch && launch.emulator) {
            const old = platformOptions.get(launch.platform)!;
            const gv = launch.emulator.gameVersion;
            old.push({
              gameId: gv.game.id,
              versionId: gv.versionId,
              name: gv.game.mName,
              iconObjectId: gv.game.mIconObjectId,
              shortDescription: gv.game.mShortDescription,
              size: (await gameSizeManager.getVersionSize(gv.versionId))!,
            });
          }
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
