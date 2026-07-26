import { defineClientEventHandler } from "~/server/internal/clients/event-handler";
import { GameType } from "~/prisma/client/enums";
import prisma from "~/server/internal/db/database";

// Lists the mods available for a base game. A mod is a Game with type=Mod and
// parentGameId pointing at this game. The client store detail page renders
// these so the user can install them onto an owned/installed base game.
export default defineClientEventHandler(async (h3) => {
  const id = getRouterParam(h3, "id");
  if (!id)
    throw createError({ statusCode: 400, statusMessage: "No ID in route" });

  const mods = await prisma.game.findMany({
    where: {
      type: GameType.Mod,
      parentGameId: id,
    },
    select: {
      id: true,
      mName: true,
      mShortDescription: true,
      mIconObjectId: true,
      // Latest version's prerequisite mods, for a "Requires: X" hint and the
      // uninstall-a-dependency warning on the client.
      versions: {
        orderBy: { versionIndex: "desc" },
        take: 1,
        select: {
          requiredContent: {
            select: {
              gameId: true,
              game: { select: { type: true, mName: true } },
            },
          },
        },
      },
    },
    orderBy: {
      mName: "asc",
    },
  });

  return mods.map((mod) => ({
    id: mod.id,
    mName: mod.mName,
    mShortDescription: mod.mShortDescription,
    mIconObjectId: mod.mIconObjectId,
    requiredMods: (mod.versions[0]?.requiredContent ?? [])
      .filter((rc) => rc.game.type === GameType.Mod)
      .map((rc) => ({ gameId: rc.gameId, name: rc.game.mName })),
  }));
});
