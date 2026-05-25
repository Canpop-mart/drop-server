import aclManager from "~/server/internal/acls";
import prisma from "~/server/internal/db/database";

export default defineEventHandler(async (h3) => {
  const allowed = await aclManager.allowSystemACL(h3, ["user:read"]);
  if (!allowed) throw createError({ statusCode: 403 });

  const users = await prisma.user.findMany({
    where: {
      id: { not: "system" },
    },
  });

  if (users.length === 0) return [];

  const userIds = users.map((u) => u.id);
  const authMecs = await prisma.linkedAuthMec.findMany({
    where: { userId: { in: userIds } },
    select: { userId: true, mec: true },
  });

  const mecsByUser = new Map<
    string,
    Array<{ mec: (typeof authMecs)[number]["mec"] }>
  >();
  for (const am of authMecs) {
    const arr = mecsByUser.get(am.userId) ?? [];
    arr.push({ mec: am.mec });
    mecsByUser.set(am.userId, arr);
  }

  // cloudSaveQuotaBytes is a Prisma BigInt; coerce to number so the wire
  // payload is plain JSON (Nuxt's default serializer turns BigInt into a
  // string, which the admin modal would have to special-case). Range is
  // bounded ≤ Number.MAX_SAFE_INTEGER by the quota POST endpoint.
  return users.map((u) => ({
    ...u,
    cloudSaveQuotaBytes: Number(u.cloudSaveQuotaBytes),
    authMecs: mecsByUser.get(u.id) ?? [],
  }));
});
