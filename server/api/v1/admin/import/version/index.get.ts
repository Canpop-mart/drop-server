import aclManager from "~/server/internal/acls";
import prisma from "~/server/internal/db/database";
import libraryManager from "~/server/internal/library";
import { GameType } from "~/prisma/client/enums";

export default defineEventHandler(async (h3) => {
  const allowed = await aclManager.allowSystemACL(h3, ["import:version:read"]);
  if (!allowed) throw createError({ statusCode: 403 });

  const query = await getQuery(h3);
  const gameId = query.id?.toString();
  if (!gameId)
    throw createError({
      statusCode: 400,
      statusMessage: "Missing id in request params",
    });

  const game = await prisma.game.findUnique({
    where: { id: gameId },
    select: {
      libraryId: true,
      libraryPath: true,
      type: true,
      parentGameId: true,
    },
  });
  if (!game || !game.libraryId)
    throw createError({ statusCode: 404, statusMessage: "Game not found" });

  const unimportedVersions = await libraryManager.fetchUnimportedGameVersions(
    game.libraryId,
    game.libraryPath,
  );
  if (!unimportedVersions)
    throw createError({ statusCode: 400, statusMessage: "Invalid game ID" });

  // For a mod, offer its sibling mods (same parent) as prerequisite choices in
  // the import wizard. Each is reduced to its latest version id, which is what
  // the requiredContent relation links to.
  let siblingMods: Array<{
    id: string;
    name: string;
    latestVersionId: string;
  }> = [];
  if (game.type === GameType.Mod && game.parentGameId) {
    const siblings = await prisma.game.findMany({
      where: {
        type: GameType.Mod,
        parentGameId: game.parentGameId,
        NOT: { id: gameId },
      },
      select: {
        id: true,
        mName: true,
        versions: {
          orderBy: { versionIndex: "desc" },
          take: 1,
          select: { versionId: true },
        },
      },
      orderBy: { mName: "asc" },
    });
    siblingMods = siblings
      .filter((s) => s.versions.length > 0)
      .map((s) => ({
        id: s.id,
        name: s.mName,
        latestVersionId: s.versions[0].versionId,
      }));
  }

  return { versions: unimportedVersions, type: game.type, siblingMods };
});
