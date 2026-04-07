import { type } from "arktype";
import { Platform } from "~/prisma/client/enums";
import {
  readDropValidatedBody,
  throwingArktype,
  requireRouterParam,
} from "~/server/arktype";
import aclManager from "~/server/internal/acls";
import prisma from "~/server/internal/db/database";

const UpdateLaunches = type({
  launches: type({
    platform: type.valueOf(Platform),
    name: "string",
    command: "string",
    emulatorId: "string?",
    suggestions: "string[]?",
    discPaths: "string[]?",
    umuIdOverride: "string?",
    umuStoreOverride: "string?",
  }).array(),
}).configure(throwingArktype);

export default defineEventHandler(async (h3) => {
  const allowed = await aclManager.allowSystemACL(h3, ["game:version:update"]);
  if (!allowed) throw createError({ statusCode: 403 });

  const gameId = requireRouterParam(h3, "id");
  const versionId = requireRouterParam(h3, "versionId");
  const body = await readDropValidatedBody(h3, UpdateLaunches);

  // Verify version belongs to this game
  const version = await prisma.gameVersion.findFirst({
    where: { versionId, gameId },
  });
  if (!version)
    throw createError({ statusCode: 404, statusMessage: "Version not found" });

  // Check if any existing launches are referenced as emulators by OTHER versions
  const existingLaunches = await prisma.launchConfiguration.findMany({
    where: { versionId },
    select: {
      launchId: true,
      emulations: { select: { launchId: true, versionId: true } },
    },
  });

  const referencedLaunches = existingLaunches.filter(
    (l) => l.emulations.length > 0,
  );
  if (referencedLaunches.length > 0) {
    // Some launches are used as emulators by other games — we can't just delete them.
    // We need to check if the emulation references are from OTHER versions only.
    const externalRefs = referencedLaunches.filter((l) =>
      l.emulations.some((e) => e.versionId !== versionId),
    );
    if (externalRefs.length > 0) {
      throw createError({
        statusCode: 409,
        statusMessage: `Cannot replace launches: ${externalRefs.length} launch configuration(s) are referenced as emulators by other game versions. Update those versions first.`,
      });
    }
  }

  // Validate emulatorIds exist if provided
  const emulatorIds = body.launches
    .map((l) => l.emulatorId)
    .filter((id): id is string => !!id);
  if (emulatorIds.length > 0) {
    const found = await prisma.launchConfiguration.findMany({
      where: { launchId: { in: emulatorIds } },
      select: { launchId: true },
    });
    const foundIds = new Set(found.map((f) => f.launchId));
    const missing = emulatorIds.filter((id) => !foundIds.has(id));
    if (missing.length > 0) {
      throw createError({
        statusCode: 400,
        statusMessage: `Emulator launch IDs not found: ${missing.join(", ")}`,
      });
    }
  }

  // Transaction: delete all existing launches, create new ones
  await prisma.$transaction([
    prisma.launchConfiguration.deleteMany({ where: { versionId } }),
    ...body.launches.map((launch) =>
      prisma.launchConfiguration.create({
        data: {
          versionId,
          platform: launch.platform,
          name: launch.name,
          command: launch.command,
          emulatorId: launch.emulatorId ?? null,
          emulatorSuggestions: launch.suggestions ?? [],
          discPaths: launch.discPaths ?? [],
          umuIdOverride: launch.umuIdOverride ?? null,
          umuStoreOverride: launch.umuStoreOverride ?? null,
        },
      }),
    ),
  ]);

  // Return the new launches
  const newLaunches = await prisma.launchConfiguration.findMany({
    where: { versionId },
    include: {
      emulator: {
        include: {
          gameVersion: {
            select: {
              versionId: true,
              displayName: true,
              versionPath: true,
              game: {
                select: {
                  id: true,
                  mName: true,
                  mIconObjectId: true,
                },
              },
            },
          },
        },
      },
      emulations: { select: { launchId: true } },
    },
  });

  return newLaunches;
});
