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

  // Only sync games that still exist. A client can report a game it has
  // installed locally that was since deleted server-side (e.g. a mod that was
  // re-imported under a new id), which would otherwise violate the
  // ClientInstalledGame FK and 500 the whole sync on startup.
  const existing = await prisma.game.findMany({
    where: { id: { in: body.gameIds } },
    select: { id: true },
  });
  const existingIds = existing.map((g) => g.id);

  // Delete all existing records for this client, then insert the new set
  await prisma.$transaction([
    prisma.clientInstalledGame.deleteMany({
      where: { clientId },
    }),
    ...existingIds.map((gameId) =>
      prisma.clientInstalledGame.create({
        data: { clientId, gameId },
      }),
    ),
  ]);

  return { synced: existingIds.length };
});
