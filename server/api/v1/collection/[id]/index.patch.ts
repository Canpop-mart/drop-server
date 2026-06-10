import { type } from "arktype";
import { readDropValidatedBody, throwingArktype } from "~/server/arktype";
import aclManager from "~/server/internal/acls";
import prisma from "~/server/internal/db/database";

const UpdateCollection = type({
  "name?": "string",
  "description?": "string | null",
}).configure(throwingArktype);

/**
 * Update a collection's editable metadata (name + store description).
 * Owner-scoped — the `featured` flag is published separately (admin-gated)
 * via featured.put.ts, and visibility via visibility.put.ts.
 */
export default defineEventHandler(async (h3) => {
  const userId = await aclManager.getUserIdACL(h3, ["collections:add"]);
  if (!userId) throw createError({ statusCode: 403 });

  const id = getRouterParam(h3, "id");
  if (!id) throw createError({ statusCode: 400, statusMessage: "Missing ID" });

  const body = await readDropValidatedBody(h3, UpdateCollection);

  const result = await prisma.collection.updateMany({
    where: { id, userId },
    data: {
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.description !== undefined
        ? { description: body.description }
        : {}),
    },
  });
  if (result.count === 0)
    throw createError({
      statusCode: 404,
      statusMessage: "Collection not found",
    });
  return { ok: true };
});
