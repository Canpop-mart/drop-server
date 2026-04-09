import aclManager from "~/server/internal/acls";
import prisma from "~/server/internal/db/database";

/**
 * Returns a list of libraries (id + name) for the store filter UI.
 */
export default defineEventHandler(async (h3) => {
  const userId = await aclManager.getUserIdACL(h3, ["store:read"]);
  if (!userId) throw createError({ statusCode: 403 });

  const libraries = await prisma.library.findMany({
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  return libraries;
});
