import { type } from "arktype";
import { Platform } from "~/prisma/client/enums";
import {
  readDropValidatedBody,
  throwingArktype,
  requireRouterParam,
} from "~/server/arktype";
import aclManager from "~/server/internal/acls";
import prisma from "~/server/internal/db/database";

const UpdateSetups = type({
  setups: type({
    platform: type.valueOf(Platform),
    command: "string",
  }).array(),
}).configure(throwingArktype);

export default defineEventHandler(async (h3) => {
  const allowed = await aclManager.allowSystemACL(h3, ["game:version:update"]);
  if (!allowed) throw createError({ statusCode: 403 });

  const gameId = requireRouterParam(h3, "id");
  const versionId = requireRouterParam(h3, "versionId");
  const body = await readDropValidatedBody(h3, UpdateSetups);

  // Verify version belongs to this game
  const version = await prisma.gameVersion.findFirst({
    where: { versionId, gameId },
  });
  if (!version)
    throw createError({ statusCode: 404, statusMessage: "Version not found" });

  // Transaction: delete all existing setups, create new ones
  await prisma.$transaction([
    prisma.setupConfiguration.deleteMany({ where: { versionId } }),
    ...body.setups.map((setup) =>
      prisma.setupConfiguration.create({
        data: {
          versionId,
          platform: setup.platform,
          command: setup.command,
        },
      }),
    ),
  ]);

  // Return the new setups
  const newSetups = await prisma.setupConfiguration.findMany({
    where: { versionId },
  });

  return newSetups;
});
