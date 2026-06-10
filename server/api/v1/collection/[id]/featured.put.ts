import aclManager from "~/server/internal/acls";
import prisma from "~/server/internal/db/database";

/**
 * Feature / unfeature a collection on the store-home shelf. Admin-gated
 * (game:update — store-content management) rather than owner-scoped: featuring
 * publishes a collection into the curated store, which is a store action, not
 * the personal-sharing one (that's isPublic via visibility.put). Featuring
 * forces isPublic on, since an unlisted collection can't appear on the store.
 */
export default defineEventHandler(async (h3) => {
  const allowed = await aclManager.allowSystemACL(h3, ["game:update"]);
  if (!allowed) throw createError({ statusCode: 403 });

  const id = getRouterParam(h3, "id");
  if (!id) throw createError({ statusCode: 400, statusMessage: "Missing ID" });

  const body = await readBody(h3);
  const featured = body?.featured === true;

  const result = await prisma.collection.updateMany({
    where: { id },
    data: featured ? { featured: true, isPublic: true } : { featured: false },
  });
  if (result.count === 0)
    throw createError({
      statusCode: 404,
      statusMessage: "Collection not found",
    });
  return { featured };
});
