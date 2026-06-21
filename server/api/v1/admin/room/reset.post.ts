import aclManager from "~/server/internal/acls";
import prisma from "~/server/internal/db/database";
import roomManager from "~/server/internal/zerotier";

/**
 * POST /api/v1/admin/room/reset — clean up rooms. Body `{ includeActive?: true }`
 * tears down EVERY room (the nuclear option); otherwise just reaps expired ones.
 */
export default defineEventHandler(async (h3) => {
  const allowed = await aclManager.allowSystemACL(h3, ["room:delete"]);
  if (!allowed) throw createError({ statusCode: 403 });

  // POSTs may have no body; tolerate it.
  const body = await readBody(h3).catch(() => ({}));
  const includeActive = body?.includeActive === true;

  if (includeActive) {
    const all = await prisma.room.findMany({
      select: { id: true, networkId: true },
    });
    for (const r of all) {
      try {
        await roomManager.destroyRoom(r.id, r.networkId);
      } catch {
        // best-effort; a controller hiccup shouldn't fail the whole reset
      }
    }
    return { destroyed: all.length };
  }

  await roomManager.reapExpired();
  return { ok: true };
});
