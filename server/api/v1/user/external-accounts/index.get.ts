import aclManager from "~/server/internal/acls";
import prisma from "~/server/internal/db/database";

export default defineEventHandler(async (h3) => {
  const userId = await aclManager.getUserIdACL(h3, ["read"]);
  if (!userId) throw createError({ statusCode: 403 });

  const externalAccounts = await prisma.userExternalAccount.findMany({
    where: { userId },
    select: {
      id: true,
      provider: true,
      externalId: true,
      // Explicitly exclude token for security
    },
  });

  return {
    accounts: externalAccounts,
  };
});
