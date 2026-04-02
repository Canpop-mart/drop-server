import aclManager from "~/server/internal/acls";
import prisma from "~/server/internal/db/database";

/**
 * List all cloud save slots for the authenticated user (web UI).
 * Returns saves with their associated game name and icon for display.
 */
export default defineEventHandler(async (h3) => {
  const user = await aclManager.getUserACL(h3, ["store:read"]);
  if (!user) throw createError({ statusCode: 403 });

  const saves = await prisma.saveSlot.findMany({
    where: { userId: user.id },
    include: {
      game: {
        select: {
          id: true,
          mName: true,
          mIconObjectId: true,
        },
      },
    },
    orderBy: [{ gameId: "asc" }, { index: "asc" }],
  });

  return saves;
});
