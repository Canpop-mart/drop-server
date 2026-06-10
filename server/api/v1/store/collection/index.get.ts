import aclManager from "~/server/internal/acls";
import prisma from "~/server/internal/db/database";

/**
 * Public list of featured store collections (curated game groups) for the
 * store-home "Collections" shelf. A collection appears only when it is both
 * public AND featured (featured is admin-gated). Shape is intentionally light
 * — name, cover, blurb, game count.
 */
export default defineEventHandler(async (h3) => {
  const userId = await aclManager.getUserIdACL(h3, ["store:read"]);
  if (!userId) throw createError({ statusCode: 403 });

  const collections = await prisma.collection.findMany({
    where: { isPublic: true, featured: true },
    orderBy: [{ sortIndex: "asc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      description: true,
      coverObjectId: true,
      _count: { select: { entries: true } },
    },
  });

  return collections.map((c) => ({
    id: c.id,
    name: c.name,
    description: c.description,
    coverObjectId: c.coverObjectId,
    gameCount: c._count.entries,
  }));
});
