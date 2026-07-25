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
    },
    orderBy: {
      mName: "asc",
    },
  });

  return mods;
});
