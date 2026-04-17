import { type } from "arktype";
import { readDropValidatedBody, throwingArktype } from "~/server/arktype";
import { defineClientEventHandler } from "~/server/internal/clients/event-handler";
import prisma from "~/server/internal/db/database";

const SyncBody = type({
  gameIds: "string[]",
}).configure(throwingArktype);

/**
 * Sync installed game list from a client device.
 * Replaces the entire installed-games set for this client with the provided list.
 * Called by clients on startup and after install/uninstall.
 */
export default defineClientEventHandler(async (h3, { clientId }) => {
  const body = await readDropValidatedBody(h3, SyncBody);

  // Delete all existing records for this client, then insert the new set
  await prisma.$transaction([
    prisma.clientInstalledGame.deleteMany({
      where: { clientId },
    }),
    ...body.gameIds.map((gameId: string) =>
      prisma.clientInstalledGame.create({
        data: { clientId, gameId },
      }),
    ),
  ]);

  return { synced: body.gameIds.length };
});
