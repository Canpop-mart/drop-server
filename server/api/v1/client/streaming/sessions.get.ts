import { defineClientEventHandler } from "~/server/internal/clients/event-handler";
import prisma from "~/server/internal/db/database";

/**
 * List active streaming sessions for the current user.
 * Used by remote clients to discover which machines are available
 * to stream from. Sessions older than 5 minutes without a heartbeat
 * are automatically marked as stopped.
 */
export default defineClientEventHandler(async (_h3, { fetchUser }) => {
  const user = await fetchUser();

  // Clean up stale sessions (no heartbeat in 5 minutes)
  const staleThreshold = new Date(Date.now() - 5 * 60 * 1000);
  await prisma.streamingSession.updateMany({
    where: {
      userId: user.id,
      status: { in: ["Starting", "Ready", "Streaming"] },
      lastHeartbeat: { lt: staleThreshold },
    },
    data: { status: "Stopped" },
  });

  const sessions = await prisma.streamingSession.findMany({
    where: {
      userId: user.id,
      status: { in: ["Starting", "Ready", "Streaming"] },
    },
    include: {
      hostClient: {
        select: {
          id: true,
          name: true,
          platform: true,
        },
      },
      game: {
        select: {
          id: true,
          mName: true,
          mIconObjectId: true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  return sessions.map((s) => ({
    id: s.id,
    status: s.status,
    hostClient: s.hostClient,
    game: s.game,
    sunshinePort: s.sunshinePort,
    hostLocalIp: s.hostLocalIp,
    hostExternalIp: s.hostExternalIp,
    hasPairingPin: !!s.pairingPin,
    createdAt: s.createdAt.toISOString(),
    lastHeartbeat: s.lastHeartbeat.toISOString(),
  }));
});
