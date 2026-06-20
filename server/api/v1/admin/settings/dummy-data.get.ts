import aclManager from "~/server/internal/acls";
import prisma from "~/server/internal/db/database";

export default defineEventHandler(async (h3) => {
  // Admin-only: getUserACL passes any authenticated session (sessions hold every
  // userACL). allowSystemACL is the only check that verifies user.admin.
  const allowed = await aclManager.allowSystemACL(h3, ["settings:update"]);
  if (!allowed) throw createError({ statusCode: 403 });

  const game = await prisma.game.findFirst();

  return { game };
});
