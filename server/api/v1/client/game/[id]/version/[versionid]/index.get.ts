import { defineClientEventHandler } from "~/server/internal/clients/event-handler";
import prisma from "~/server/internal/db/database";
import { LibraryBackend } from "~/prisma/client/enums";
import { createEmulatorResolver } from "~/server/internal/library/emulatorResolution";

export default defineClientEventHandler(async (h3) => {
  const id = getRouterParam(h3, "id");
  const version = getRouterParam(h3, "versionid");
  if (!id || !version)
    throw createError({
      statusCode: 400,
      statusMessage: "Missing id or version in route params",
    });

  const gameVersion = await prisma.gameVersion.findUnique({
    where: {
      versionId: version,
    },
    include: {
      launches: {
        include: {
          emulator: {
            include: {
              gameVersion: {
                select: {
                  game: {
                    select: {
                      id: true,
                    },
                  },
                },
              },
            },
          },
        },
      },
      setups: true,
    },
  });

  if (!gameVersion)
    throw createError({
      statusCode: 404,
      statusMessage: "Game version not found",
    });

  // Console ROMs live in FlatFilesystem libraries; only they re-derive a wiped
  // emulator link by ROM extension, so PC games skip the emulator scan.
  const game = await prisma.game.findUnique({
    where: { id },
    select: { library: { select: { backend: true } } },
  });
  const isConsole = game?.library?.backend === LibraryBackend.FlatFilesystem;

  const emulatorResolver = createEmulatorResolver();

  // The client resolves + downloads the emulator strictly by this triple, so
  // emit { launchId, gameId, versionId } from the emulator's CURRENT version
  // (never the pinned one), re-deriving it when an emulator re-version wiped the
  // stored link. This is how a ROM's launch stays resolvable end to end.
  const launches = await Promise.all(
    gameVersion.launches.map(async (launch) => {
      const { emulator: rawEmulator, ...rest } = launch;
      const emulatorGameId = rawEmulator?.gameVersion.game.id ?? null;

      let emulator:
        | { launchId: string; gameId: string; versionId: string }
        | undefined;
      if (emulatorGameId || isConsole) {
        const resolved = await emulatorResolver.resolve({
          platform: launch.platform,
          command: launch.command,
          emulatorGameId,
          emulatorLaunchName: rawEmulator?.name ?? null,
        });
        if (resolved)
          emulator = {
            launchId: resolved.launchId,
            gameId: resolved.gameId,
            versionId: resolved.versionId,
          };
      }

      return { ...rest, emulator };
    }),
  );

  return { ...gameVersion, launches };
});
