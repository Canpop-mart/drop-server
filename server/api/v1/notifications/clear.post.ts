import aclManager from "~/server/internal/acls";
import prisma from "~/server/internal/db/database";

/**
 * Deletes every notification the caller can see. Needs `notifications:delete`,
 * not `notifications:mark`: the desktop client's token is given `mark` (to
 * mark request decisions read) but must not be able to wipe the list. Client
 * tokens never hold `delete` (CLIENT_WEBTOKEN_ACLS in
 * server/plugins/04.auth-init.ts, re-applied to every client token on boot).
 */
export default defineEventHandler(async (h3) => {
  const userId = await aclManager.getUserIdACL(h3, ["notifications:delete"]);
  if (!userId) throw createError({ statusCode: 403 });

  const acls = await aclManager.fetchAllACLs(h3);
  if (!acls)
    throw createError({
      statusCode: 500,
      statusMessage: "Got userId but no ACLs - what?",
    });

  await prisma.notification.deleteMany({
    where: {
      userId,
      acls: {
        hasSome: acls,
      },
    },
  });

  return;
});
