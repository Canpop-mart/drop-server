import { defineClientEventHandler } from "~/server/internal/clients/event-handler";
import prisma from "~/server/internal/db/database";

/**
 * List all registered client devices for the current user.
 * Optional ?gameId= query param adds `hasGame` boolean per device.
 * Ordered by most recently connected first.
 */
export default defineClientEventHandler(async (h3, { clientId, fetchUser }) => {
  const user = await fetchUser();
  const query = getQuery(h3);
  const gameId = typeof query.gameId === "string" ? query.gameId : undefined;

  const devices = await prisma.client.findMany({
    where: {
      userId: user.id,
    },
    select: {
      id: true,
      name: true,
      platform: true,
      lastConnected: true,
      ...(gameId
        ? {
            installedGames: {
              where: { gameId },
              select: { gameId: true },
            },
          }
        : {}),
    },
    orderBy: { lastConnected: "desc" },
  });

  return devices.map((device) => {
    const base = {
      id: device.id,
      name: device.name,
      platform: device.platform,
      lastConnected: device.lastConnected.toISOString(),
      isSelf: device.id === clientId,
    };
    if (gameId !== undefined && "installedGames" in device) {
      const installed = device.installedGames as { gameId: string }[];
      return { ...base, hasGame: installed.length > 0 };
    }
    return base;
  });
});
