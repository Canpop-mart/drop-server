import aclManager from "~/server/internal/acls";
import { GameType } from "~/prisma/client/enums";
import prisma from "~/server/internal/db/database";

// Public (web store) list of the mods available for a game. Browse only — a
// browser can't install; the desktop client's library page does the install.
export default defineEventHandler(async (h3) => {
  const userId = await aclManager.getUserIdACL(h3, ["store:read"]);
  if (!userId) throw createError({ statusCode: 403 });

  const gameId = getRouterParam(h3, "id");
  if (!gameId)
    throw createError({ statusCode: 400, statusMessage: "No game ID." });

  // Full rows so the web store's GameCarousel (which expects GameModel) can
  // render mod tiles the same way it renders games.
  return await prisma.game.findMany({
    where: { type: GameType.Mod, parentGameId: gameId },
    orderBy: { mName: "asc" },
  });
});
