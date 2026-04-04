import aclManager from "~/server/internal/acls";
import prisma from "~/server/internal/db/database";

export default defineEventHandler(async (h3) => {
  const allowed = await aclManager.allowSystemACL(h3, ["game:update"]);
  if (!allowed) throw createError({ statusCode: 403 });

  const gameId = getRouterParam(h3, "id");
  if (!gameId)
    throw createError({ statusCode: 400, statusMessage: "No game ID" });

  const body = await readBody(h3);
  if (!body || typeof body !== "object")
    throw createError({ statusCode: 400, statusMessage: "Invalid body" });

  const game = await prisma.game.findUnique({
    where: { id: gameId },
    select: { id: true },
  });
  if (!game)
    throw createError({ statusCode: 404, statusMessage: "Game not found" });

  await prisma.game.updateMany({
    where: { id: gameId },
    data: { savePaths: body },
  });

  return { success: true };
});
