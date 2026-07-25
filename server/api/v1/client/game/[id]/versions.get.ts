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
  requiredContent: Array<{
    gameId: string;
    versionId: string;
    name: string;
    iconObjectId: string;
    shortDescription: string;
    size: GameVersionSize;
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

        if (!size) return [];

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
              }) satisfies VersionDownloadOption,
          )
          .toArray();
      }),
    )
  ).flat();

  return versions;
});
