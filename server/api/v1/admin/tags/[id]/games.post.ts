import { type } from "arktype";
import {
  readDropValidatedBody,
  throwingArktype,
  requireRouterParam,
} from "~/server/arktype";
import aclManager from "~/server/internal/acls";
import prisma from "~/server/internal/db/database";

const BulkAssign = type({
  gameIds: "string[]",
}).configure(throwingArktype);

/**
 * Bulk-assign a tag to many games at once.
 *
 * `POST /api/v1/admin/tags/:id/games` with `{ gameIds: string[] }` connects the
 * tag to every (valid) game in the list — the bulk counterpart of the per-game
 * `PATCH /admin/game/:id/tags`. Connecting an already-tagged game is a no-op,
 * so this is idempotent and safe to re-run.
 */
export default defineEventHandler(async (h3) => {
  const allowed = await aclManager.allowSystemACL(h3, ["game:update"]);
  if (!allowed) throw createError({ statusCode: 403 });

  const id = requireRouterParam(h3, "id");
  const body = await readDropValidatedBody(h3, BulkAssign);

  const tag = await prisma.gameTag.findUnique({
    where: { id },
    select: { id: true },
  });
  if (!tag) throw createError({ statusCode: 404, message: "Tag not found" });

  // Only connect games that actually exist — silently drop stale/invalid ids
  // rather than failing the whole batch.
  const games = await prisma.game.findMany({
    where: { id: { in: body.gameIds } },
    select: { id: true },
  });

  if (games.length > 0) {
    // SAFETY: tag existence is verified above; a relation `connect` can only be
    // expressed via update(), not updateMany().
    // eslint-disable-next-line drop/no-prisma-delete
    await prisma.gameTag.update({
      where: { id },
      data: {
        games: {
          connect: games.map((g) => ({ id: g.id })),
        },
      },
    });
  }

  return { connected: games.length };
});
