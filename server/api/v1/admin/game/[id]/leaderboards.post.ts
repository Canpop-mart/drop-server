import { type } from "arktype";
import { readDropValidatedBody, throwingArktype } from "~/server/arktype";
import aclManager from "~/server/internal/acls";
import prisma from "~/server/internal/db/database";

const CreateLeaderboard = type({
  name: "string",
  type: "'Playtime' | 'AchievementCount' | 'Speedrun' | 'Score'",
  sortOrder: "'Asc' | 'Desc' | undefined",
}).configure(throwingArktype);

export default defineEventHandler(async (h3) => {
  const allowed = await aclManager.allowSystemACL(h3, ["game:update"]);
  if (!allowed) throw createError({ statusCode: 403 });

  const gameId = getRouterParam(h3, "id");
  if (!gameId)
    throw createError({ statusCode: 400, statusMessage: "No gameId." });

  const game = await prisma.game.findUnique({ where: { id: gameId } });
  if (!game)
    throw createError({ statusCode: 404, statusMessage: "Game not found." });

  const body = await readDropValidatedBody(h3, CreateLeaderboard);

  const leaderboard = await prisma.leaderboard.create({
    data: {
      gameId,
      name: body.name,
      type: body.type as never,
      sortOrder: (body.sortOrder ?? "Desc") as never,
    },
  });

  return leaderboard;
});
