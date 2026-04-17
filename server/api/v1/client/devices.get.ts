import { defineClientEventHandler } from "~/server/internal/clients/event-handler";
import prisma from "~/server/internal/db/database";

/**
 * List all registered client devices for the current user.
 * Returns device information with a flag indicating if it's the requesting client.
 * Ordered by most recently connected first.
 */
export default defineClientEventHandler(
  async (_h3, { clientId, fetchUser }) => {
    const user = await fetchUser();

    const devices = await prisma.client.findMany({
      where: {
        userId: user.id,
      },
      select: {
        id: true,
        name: true,
        platform: true,
        lastConnected: true,
      },
      orderBy: { lastConnected: "desc" },
    });

    return devices.map((device) => ({
      id: device.id,
      name: device.name,
      platform: device.platform,
      lastConnected: device.lastConnected.toISOString(),
      isSelf: device.id === clientId,
    }));
  },
);
