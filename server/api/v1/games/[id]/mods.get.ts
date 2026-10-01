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

  // Rows shaped like the store's other game lists so GameCarousel can render
  // mod tiles the same way it renders games, minus where the files live on
  // the server: any store:read user can call this.
  return await prisma.game.findMany({
    where: { type: GameType.Mod, parentGameId: gameId },
    orderBy: { mName: "asc" },
    omit: { libraryId: true, libraryPath: true, discFolders: true },
  });
});
