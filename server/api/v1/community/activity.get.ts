import aclManager from "~/server/internal/acls";
import prisma from "~/server/internal/db/database";

export default defineEventHandler(async (h3) => {
  const userId = await aclManager.getUserIdACL(h3, ["store:read"]);
  if (!userId) throw createError({ statusCode: 403 });

  // Get recent play sessions across all users (public activity)
  const sessions = await prisma.playSession.findMany({
    orderBy: { startedAt: "desc" },
    take: 20,
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
  });

  // Get recent achievement unlocks across all users
  const achievements = await prisma.userAchievement.findMany({
    orderBy: { unlockedAt: "desc" },
    take: 20,
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
            select: {
              id: true,
              mName: true,
              mIconObjectId: true,
            },
          },
        },
      },
    },
  });

  // Combine and sort by time
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
  ].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  return activityItems.slice(0, 30);
});