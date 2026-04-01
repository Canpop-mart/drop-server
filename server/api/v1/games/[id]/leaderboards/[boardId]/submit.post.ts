import { type } from "arktype";
import { readDropValidatedBody, throwingArktype } from "~/server/arktype";
import aclManager from "~/server/internal/acls";
import prisma from "~/server/internal/db/database";

const SubmitEntry = type({
  score: "number",
  data: "unknown | undefined",
}).configure(throwingArktype);

export default defineEventHandler(async (h3) => {
  const userId = await aclManager.getUserIdACL(h3, ["store:read"]);
  if (!userId) throw createError({ statusCode: 403 });

  const gameId = getRouterParam(h3, "id");
  const boardId = getRouterParam(h3, "boardId");
  if (!gameId || !boardId)
    throw createError({ statusCode: 400, statusMessage: "Missing params." });

  const leaderboard = await prisma.leaderboard.findUnique({
    where: { id: boardId },
  });
  if (!leaderboard || leaderboard.gameId !== gameId)
    throw createError({
      statusCode: 404,
      statusMessage: "Leaderboard not found.",
    });

  const body = await readDropValidatedBody(h3, SubmitEntry);

  // Upsert entry
  await prisma.leaderboardEntry.upsert({
    where: { leaderboardId_userId: { leaderboardId: boardId, userId } },
    create: {
      leaderboardId: boardId,
      userId,
      score: body.score,
      data: body.data ?? undefined,
    },
    update: {
      score: body.score,
      data: body.data ?? undefined,
      submittedAt: new Date(),
    },
  });

  // Recalculate ranks for all entries in this leaderboard
  const allEntries = await prisma.leaderboardEntry.findMany({
    where: { leaderboardId: boardId },
    orderBy:
      leaderboard.sortOrder === "Asc" ? { score: "asc" } : { score: "desc" },
    select: { id: true },
  });

  await prisma.$transaction(
    allEntries.map((entry, idx) =>
      prisma.leaderboardEntry.updateMany({
        where: { id: entry.id },
        data: { rank: idx + 1 },
      }),
    ),
  );

  // Return caller's updated entry
  const updated = await prisma.leaderboardEntry.findUnique({
    where: { leaderboardId_userId: { leaderboardId: boardId, userId } },
    select: { score: true, rank: true, submittedAt: true },
  });

  return updated;
});
