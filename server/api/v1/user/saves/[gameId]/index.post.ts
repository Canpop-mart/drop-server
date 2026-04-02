import aclManager from "~/server/internal/acls";
import { applicationSettings } from "~/server/internal/config/application-configuration";
import prisma from "~/server/internal/db/database";

/**
 * Create a new save slot for the authenticated user on a specific game.
 * Auto-assigns the next available slot index.
 */
export default defineEventHandler(async (h3) => {
  const user = await aclManager.getUserACL(h3, ["store:read"]);
  if (!user) throw createError({ statusCode: 403 });

  const gameId = getRouterParam(h3, "gameId");
  if (!gameId)
    throw createError({
      statusCode: 400,
      statusMessage: "No gameId in route params",
    });

  const game = await prisma.game.findUnique({
    where: { id: gameId },
    select: { id: true },
  });
  if (!game)
    throw createError({ statusCode: 400, statusMessage: "Invalid game ID" });

  const saves = await prisma.saveSlot.findMany({
    where: { userId: user.id, gameId },
    orderBy: { index: "asc" },
  });

  const limit = await applicationSettings.get("saveSlotCountLimit");
  if (saves.length + 1 > limit)
    throw createError({
      statusCode: 400,
      statusMessage: "Out of save slots",
    });

  // Find the first available index
  let firstIndex = 0;
  for (const save of saves) {
    if (firstIndex === save.index) firstIndex++;
  }

  const newSlot = await prisma.saveSlot.create({
    data: {
      userId: user.id,
      gameId,
      index: firstIndex,
    },
  });

  return newSlot;
});
