import { defineClientEventHandler } from "~/server/internal/clients/event-handler";
import prisma from "~/server/internal/db/database";

/** How long a failed session keeps being listed so the device that asked for
 *  it can read the reason. The requester polls every few seconds, so a couple
 *  of minutes is generous. */
const FAILURE_VISIBLE_MS = 2 * 60 * 1000;

/**
 * List active streaming sessions for the current user.
 * Used by remote clients to discover which machines are available
 * to stream from. Sessions older than 5 minutes without a heartbeat
 * are automatically marked as stopped.
 *
 * Sessions the host stopped *with a reason* stay in the list for
 * `FAILURE_VISIBLE_MS`, still marked Stopped. That is the only way the
 * requesting device learns why its stream died: it polls this endpoint, and a
 * session that simply vanishes leaves it counting down to a 60s timeout whose
 * message ("no host responded") is wrong for every real failure. Clients that
 * predate the `error` field filter on status and skip Stopped entries anyway.
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
      OR: [
        { status: { in: ["Requested", "Starting", "Ready", "Streaming"] } },
        {
          status: "Stopped",
          error: { not: null },
          updatedAt: { gte: new Date(Date.now() - FAILURE_VISIBLE_MS) },
        },
      ],
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
    error: s.error,
    createdAt: s.createdAt.toISOString(),
    lastHeartbeat: s.lastHeartbeat.toISOString(),
  }));
});
