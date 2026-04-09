import { requireRouterParam } from "~/server/arktype";
import aclManager from "~/server/internal/acls";
import prisma from "~/server/internal/db/database";

/**
 * Deletes ALL versions for a game. Used to reset games (e.g. ROM games)
 * whose versions were imported incorrectly.
 */
export default defineEventHandler(async (h3) => {
  const allowed = await aclManager.allowSystemACL(h3, ["game:version:delete"]);
  if (!allowed) throw createError({ statusCode: 403 });

  const gameId = requireRouterParam(h3, "id");

  const { count } = await prisma.gameVersion.deleteMany({
    where: { gameId },
  });

  return { deleted: count };
});
