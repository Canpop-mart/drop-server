import aclManager from "~/server/internal/acls";
import prisma from "~/server/internal/db/database";

/**
 * Update a save slot (e.g. rename it).
 */
export default defineEventHandler(async (h3) => {
  const user = await aclManager.getUserACL(h3, ["store:read"]);
  if (!user) throw createError({ statusCode: 403 });

  const gameId = getRouterParam(h3, "gameId");
  const slotIndex = Number(getRouterParam(h3, "slotIndex"));
  if (!gameId || Number.isNaN(slotIndex))
    throw createError({ statusCode: 400, statusMessage: "Invalid params" });

  const body = await readBody(h3);
  const updates: Record<string, unknown> = {};

  if (typeof body?.name === "string") {
    updates.name = body.name.slice(0, 64).trim();
  }

  if (Object.keys(updates).length === 0) {
    throw createError({
      statusCode: 400,
      statusMessage: "Nothing to update",
    });
  }

  const slot = await prisma.saveSlot.update({
    where: {
      id: { gameId, userId: user.id, index: slotIndex },
    },
    data: updates,
  });

  return slot;
});
