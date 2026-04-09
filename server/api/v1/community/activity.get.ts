import aclManager from "~/server/internal/acls";
import prisma from "~/server/internal/db/database";
import { RequestStatus } from "~/prisma/client/enums";

export default defineEventHandler(async (h3) => {
  const userId = await aclManager.getUserIdACL(h3, ["store:read"]);
  if (!userId) throw createError({ statusCode: 403 });

  const query = getQuery(h3);
  const limit = Math.min(Number(query.limit) || 30, 100);
  const before = query.before ? new Date(query.before as string) : undefined;

  const timeFilter = before ? { lt: before } : undefined;

  const userSelect = {
    id: true,
    username: true,
    displayName: true,
    profilePictureObjectId: true,
  } as const;

  // Fetch each activity type in parallel (no nested includes)
  const [sessions, rawAchievements, approvedRequests] = await Promise.all([
    prisma.playSession.findMany({
      where: before ? { startedAt: timeFilter } : undefined,
      orderBy: { startedAt: "desc" },
      take: limit,
    }),
    prisma.userAchievement.findMany({
      where: before ? { unlockedAt: timeFilter } : undefined,
      orderBy: { unlockedAt: "desc" },
      take: limit,
    }),
    prisma.gameRequest.findMany({
      where: {
        status: RequestStatus.Approved,
        ...(before ? { reviewedAt: timeFilter } : {}),
        reviewedAt: { not: null },
      },
      orderBy: { reviewedAt: "desc" },
      take: 20,
      select: {
        id: true,
        title: true,
        reviewedAt: true,
        requesterId: true,
        gameId: true,
      },
    }),
  ]);

  // Collect all unique user IDs and game IDs across all activity types
  const userIds = new Set<string>();
  const gameIds = new Set<string>();
  const achievementIds = new Set<string>();

  for (const s of sessions) {
    userIds.add(s.userId);
    gameIds.add(s.gameId);
  }
  for (const a of rawAchievements) {
    userIds.add(a.userId);
    achievementIds.add(a.achievementId);
  }
  for (const r of approvedRequests) {
    userIds.add(r.requesterId);
    if (r.gameId) gameIds.add(r.gameId);
  }

  // Batch-fetch achievements (to get gameIds from them)
  const achievementsData =
    achievementIds.size > 0
      ? await prisma.achievement.findMany({
          where: { id: { in: [...achievementIds] } },
          select: {
            id: true,
            title: true,
            description: true,
            iconUrl: true,
            gameId: true,
          },
        })
      : [];
  const achievementMap = new Map(achievementsData.map((a) => [a.id, a]));

  // Add game IDs from achievements
  for (const a of achievementsData) {
    gameIds.add(a.gameId);
  }

  // Batch-fetch all users and games in parallel
  const [users, games] = await Promise.all([
    userIds.size > 0
      ? prisma.user.findMany({
          where: { id: { in: [...userIds] } },
          select: userSelect,
        })
      : [],
    gameIds.size > 0
      ? prisma.game.findMany({
          where: { id: { in: [...gameIds] } },
          select: {
            id: true,
            mName: true,
            mIconObjectId: true,
            mCoverObjectId: true,
          },
        })
      : [],
  ]);

  const userMap = new Map(users.map((u) => [u.id, u]));
  const gameMap = new Map(games.map((g) => [g.id, g]));

  // Combine and sort
  const activityItems = [
    ...sessions
      .filter((s) => userMap.has(s.userId) && gameMap.has(s.gameId))
      .map((s) => ({
        type: "session" as const,
        timestamp: s.startedAt,
        user: userMap.get(s.userId)!,
        game: gameMap.get(s.gameId)!,
        data: {
          duration: s.durationSeconds,
          endedAt: s.endedAt,
        },
      })),
    ...rawAchievements
      .filter((a) => {
        const ach = achievementMap.get(a.achievementId);
        return ach && userMap.has(a.userId) && gameMap.has(ach.gameId);
      })
      .map((a) => {
        const ach = achievementMap.get(a.achievementId)!;
        return {
          type: "achievement" as const,
          timestamp: a.unlockedAt,
          user: userMap.get(a.userId)!,
          game: gameMap.get(ach.gameId)!,
          data: {
            achievement: {
              id: ach.id,
              title: ach.title,
              description: ach.description,
              iconUrl: ach.iconUrl,
            },
          },
        };
      }),
    ...approvedRequests
      .filter(
        (r) =>
          r.reviewedAt &&
          userMap.has(r.requesterId) &&
          r.gameId &&
          gameMap.has(r.gameId),
      )
      .map((r) => ({
        type: "request" as const,
        timestamp: r.reviewedAt!,
        user: userMap.get(r.requesterId)!,
        game: gameMap.get(r.gameId!)!,
        data: { request: { id: r.id, title: r.title } },
      })),
  ]
    .sort(
      (a, b) =>
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
    )
    .slice(0, limit);

  return activityItems;
});
