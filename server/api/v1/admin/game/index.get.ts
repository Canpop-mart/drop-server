import aclManager from "~/server/internal/acls";
import prisma from "~/server/internal/db/database";

/**
 * Returns all games (id + name only) for admin dropdowns.
 * Not paginated — admin-only, used where a full list is needed.
 */
export default defineEventHandler(async (h3) => {
  const allowed = await aclManager.allowSystemACL(h3, ["game:read"]);
  if (!allowed) throw createError({ statusCode: 403 });

  return prisma.game.findMany({
    select: { id: true, mName: true },
    orderBy: { mName: "asc" },
  });
});
