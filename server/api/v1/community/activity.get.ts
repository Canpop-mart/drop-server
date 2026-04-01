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

  // Fetch each activity type in parallel
  const [sessions, achievements, approvedRequests] = await Promise.all([
    prisma.playSession.findMany({
      where: before ? { startedAt: timeFilter } : undefined,
      orderBy: { startedAt: "desc" },
      take: limit,
      include: {
        user: {
          select: {
            id: true,
            username: true,
            displayName: true,
            profilePictureObjectId: true,
          },
        },
        game: {
          select: {
            id: true,
            mName: true,
            mIconObjectId: true,
            mCoverObjectId: true,
          },
        },
      },
    }),
    prisma.userAchievement.findMany({
      where: before ? { unlockedAt: timeFilter } : undefined,
      orderBy: { unlockedAt: "desc" },
      take: limit,
      include: {
        user: {
          select: {
            id: true,
            username: true,
            displayName: true,
            profilePictureObjectId: true,
          },
        },
        achievement: {
          include: {
            game: {
              select: { id: true, mName: true, mIconObjectId: true },
            },
          },
        },
      },
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
        requester: {
          select: {
            id: true,
            username: true,
            displayName: true,
            profilePictureObjectId: true,
          },
        },
        game: {
          select: { id: true, mName: true, mIconObjectId: true },
        },
      },
    }),
  ]);

  // Combine and sort
  const activityItems = [
    ...sessions.map((s) => ({
      type: "session" as const,
      timestamp: s.startedAt,
      user: s.user,
      game: s.game,
      data: {
        duration: s.durationSeconds,
        endedAt: s.endedAt,
      },
    })),
    ...achievements.map((a) => ({
      type: "achievement" as const,
      timestamp: a.unlockedAt,
      user: a.user,
      game: a.achievement.game,
      data: {
        achievement: {
          id: a.achievement.id,
          title: a.achievement.title,
          description: a.achievement.description,
          iconUrl: a.achievement.iconUrl,
        },
      },
    })),
    ...approvedRequests
      .filter((r) => r.reviewedAt)
      .map((r) => ({
        type: "request" as const,
        timestamp: r.reviewedAt!,
        user: r.requester,
        game: r.game,
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
