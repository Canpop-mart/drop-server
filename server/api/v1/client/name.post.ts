import { type } from "arktype";
import { readDropValidatedBody, throwingArktype } from "~/server/arktype";
import { defineClientEventHandler } from "~/server/internal/clients/event-handler";
import prisma from "~/server/internal/db/database";

const RenameBody = type({
  name: "0 < string <= 64",
}).configure(throwingArktype);

/**
 * POST /api/v1/client/name
 *
 * The calling client renames itself. This is the device name shown to others in
 * multiplayer (co-op rooms + Archipelago sessions). Scoped to the authenticated
 * client, so a client can only ever rename itself. Skips the write when the name
 * is unchanged, since the client re-applies it whenever a multiplayer screen
 * opens.
 */
export default defineClientEventHandler(async (h3, { clientId }) => {
  const body = await readDropValidatedBody(h3, RenameBody);
  const name = body.name.trim();
  if (!name)
    throw createError({ statusCode: 400, statusMessage: "Name is required." });

  await prisma.client.updateMany({
    where: { id: clientId, NOT: { name } },
    data: { name },
  });

  return { name };
});
