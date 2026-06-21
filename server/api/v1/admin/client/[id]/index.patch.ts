import { type } from "arktype";
import {
  readDropValidatedBody,
  requireRouterParam,
  throwingArktype,
} from "~/server/arktype";
import aclManager from "~/server/internal/acls";
import prisma from "~/server/internal/db/database";

const ClientUpdate = type({
  name: "0 < string <= 64",
}).configure(throwingArktype);

/**
 * PATCH /api/v1/admin/client/:id — rename a paired device. (Note: the client
 * may overwrite this on its next sync; this is an admin-side override.)
 */
export default defineEventHandler(async (h3) => {
  const allowed = await aclManager.allowSystemACL(h3, ["client:update"]);
  if (!allowed) throw createError({ statusCode: 403 });

  const id = requireRouterParam(h3, "id");
  const body = await readDropValidatedBody(h3, ClientUpdate);

  const [updated] = await prisma.client.updateManyAndReturn({
    where: { id },
    data: { name: body.name },
  });
  if (!updated)
    throw createError({ statusCode: 404, statusMessage: "Device not found" });

  return { id: updated.id, name: updated.name };
});
