import { type } from "arktype";
import {
  readDropValidatedBody,
  throwingArktype,
  requireRouterParam,
} from "~/server/arktype";
import aclManager from "~/server/internal/acls";
import prisma from "~/server/internal/db/database";

const UpdateVersionMetadata = type({
  displayName: "string?",
  onlySetup: "boolean?",
  delta: "boolean?",
}).configure(throwingArktype);

export default defineEventHandler(async (h3) => {
  const allowed = await aclManager.allowSystemACL(h3, ["game:version:update"]);
  if (!allowed) throw createError({ statusCode: 403 });

  const gameId = requireRouterParam(h3, "id");
  const versionId = requireRouterParam(h3, "versionId");
  const body = await readDropValidatedBody(h3, UpdateVersionMetadata);

  // Verify version belongs to this game
  const version = await prisma.gameVersion.findFirst({
    where: { versionId, gameId },
  });
  if (!version)
    throw createError({ statusCode: 404, statusMessage: "Version not found" });

  const data: Record<string, unknown> = {};
  if (body.displayName !== undefined)
    data.displayName = body.displayName || null;
  if (body.onlySetup !== undefined) data.onlySetup = body.onlySetup;
  if (body.delta !== undefined) data.delta = body.delta;

  const result = await prisma.gameVersion.updateMany({
    where: { versionId, gameId },
    data,
  });

  if (result.count === 0)
    throw createError({ statusCode: 404, statusMessage: "Version not found" });

  return { versionId, ...data };
});
