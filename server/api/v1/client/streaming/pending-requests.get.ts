import { defineClientEventHandler } from "~/server/internal/clients/event-handler";
import prisma from "~/server/internal/db/database";

/**
 * List pending stream requests for the current user.
 * Returns sessions with status "Requested" that were NOT requested by this client
 * (i.e., another device wants this client to host a stream).
 *
 * Also expires requests older than 2 minutes.
 */
export default defineClientEventHandler(
  async (_h3, { clientId, fetchUser }) => {
    const user = await fetchUser();

    // Expire old requests (>2 minutes)
    const expireThreshold = new Date(Date.now() - 2 * 60 * 1000);
    await prisma.streamingSession.updateMany({
      where: {
        userId: user.id,
        status: "Requested",
        createdAt: { lt: expireThreshold },
      },
      data: { status: "Stopped" },
    });

    // Find pending requests targeted at this device.
    // When a stream is requested with a targetClientId, hostClientId is set to the target.
    // Only show requests where this device is the intended host.
    const requests = await prisma.streamingSession.findMany({
      where: {
        userId: user.id,
        status: "Requested",
        hostClientId: clientId,
        requestingClientId: { not: clientId },
      },
      include: {
        requestingClient: {
          select: { id: true, name: true, platform: true },
        },
        game: {
          select: { id: true, mName: true, mIconObjectId: true },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    return requests.map((r) => ({
      sessionId: r.id,
      gameId: r.gameId,
      game: r.game,
      requestingClient: r.requestingClient,
      createdAt: r.createdAt.toISOString(),
      gameConfig: r.gameConfig ?? undefined,
    }));
  },
);
