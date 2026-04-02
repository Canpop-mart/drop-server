import aclManager from "~/server/internal/acls";
import prisma from "~/server/internal/db/database";

/**
 * Achievement diagnostic endpoint.
 * Returns a full health check for the achievement system for a specific game.
 * User-auth so it's accessible from the client's Vue frontend.
 */
export default defineEventHandler(async (h3) => {
  const user = await aclManager.getUserACL(h3, ["store:read"]);
  if (!user) throw createError({ statusCode: 403 });

  const gameId = getRouterParam(h3, "gameId");
  if (!gameId)
    throw createError({ statusCode: 400, statusMessage: "No gameId" });

  const game = await prisma.game.findUnique({
    where: { id: gameId },
    select: { id: true, mName: true },
  });
  if (!game)
    throw createError({ statusCode: 404, statusMessage: "Game not found" });

  // 1. External links (Goldberg AppID mapping)
  const externalLinks = await prisma.gameExternalLink.findMany({
    where: { gameId },
    select: { provider: true, externalGameId: true },
  });

  // 2. Achievement definitions in DB
  const achievements = await prisma.achievement.findMany({
    where: { gameId },
    select: {
      id: true,
      externalId: true,
      provider: true,
      title: true,
      iconUrl: true,
    },
    orderBy: { displayOrder: "asc" },
  });

  // 3. User's unlocked achievements for this game
  const achievementIds = achievements.map((a) => a.id);
  const userAchievements = await prisma.userAchievement.findMany({
    where: {
      userId: user.id,
      achievementId: { in: achievementIds },
    },
    select: {
      achievementId: true,
      unlockedAt: true,
      syncedAt: true,
    },
  });
  const unlockedMap = new Map(
    userAchievements.map((ua) => [ua.achievementId, ua]),
  );

  // 4. Active play sessions (check for orphans)
  const activeSessions = await prisma.playSession.findMany({
    where: {
      userId: user.id,
      gameId,
      endedAt: null,
    },
    select: {
      id: true,
      startedAt: true,
    },
    orderBy: { startedAt: "desc" },
    take: 5,
  });

  // 5. Clients connected to this user
  const clients = await prisma.client.findMany({
    where: { userId: user.id },
    select: {
      id: true,
      name: true,
      lastConnected: true,
    },
    orderBy: { lastConnected: "desc" },
    take: 3,
  });

  // Build diagnostic report
  const goldbergLinks = externalLinks.filter((l) => l.provider === "Goldberg");
  const goldbergAchievements = achievements.filter(
    (a) => a.provider === "Goldberg",
  );
  const unlockedCount = userAchievements.length;
  const missingIcons = achievements.filter((a) => !a.iconUrl);

  const issues: string[] = [];

  if (goldbergLinks.length === 0) {
    issues.push(
      "NO_GOLDBERG_LINK: No GameExternalLink with provider=Goldberg exists for this game. " +
        "Local achievement detection cannot work. Run the admin achievement scan.",
    );
  }
  if (achievements.length === 0) {
    issues.push(
      "NO_ACHIEVEMENTS: No achievement definitions found in DB. " +
        "Run the admin achievement scan first.",
    );
  }
  if (goldbergAchievements.length === 0 && achievements.length > 0) {
    issues.push(
      "NO_GOLDBERG_ACHIEVEMENTS: Achievements exist but none with provider=Goldberg. " +
        "The Goldberg scanner may not have been run for this game.",
    );
  }
  if (activeSessions.length > 0) {
    issues.push(
      `ORPHAN_SESSIONS: ${activeSessions.length} play session(s) still open (no endedAt). ` +
        `This means stop_playtime may be failing.`,
    );
  }
  if (clients.length === 0) {
    issues.push(
      "NO_CLIENTS: No client devices registered for this user. " +
        "The app may not be properly authenticated.",
    );
  }
  if (missingIcons.length > 0) {
    issues.push(
      `MISSING_ICONS: ${missingIcons.length} achievement(s) have no icon URL.`,
    );
  }

  return {
    game: { id: game.id, name: game.mName },
    status: issues.length === 0 ? "OK" : "ISSUES_FOUND",
    issues,
    summary: {
      totalAchievements: achievements.length,
      goldbergAchievements: goldbergAchievements.length,
      unlockedByUser: unlockedCount,
      goldbergAppIds: goldbergLinks.map((l) => l.externalGameId),
      externalLinks: externalLinks.map(
        (l) => `${l.provider}:${l.externalGameId}`,
      ),
      orphanSessions: activeSessions.length,
      connectedClients: clients.length,
    },
    details: {
      achievements: achievements.map((a) => ({
        id: a.id,
        externalId: a.externalId,
        provider: a.provider,
        title: a.title,
        hasIcon: !!a.iconUrl,
        unlocked: unlockedMap.has(a.id),
        unlockedAt: unlockedMap.get(a.id)?.unlockedAt ?? null,
      })),
      activeSessions: activeSessions.map((s) => ({
        id: s.id,
        startedAt: s.startedAt,
        ageMinutes: Math.round(
          (Date.now() - new Date(s.startedAt).getTime()) / 60000,
        ),
      })),
      clients: clients.map((c) => ({
        id: c.id,
        name: c.name,
        lastConnected: c.lastConnected,
      })),
    },
  };
});
