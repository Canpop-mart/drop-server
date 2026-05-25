import { ArkErrors, type } from "arktype";
import aclManager from "~/server/internal/acls";
import prisma from "~/server/internal/db/database";

/**
 * POST /api/v1/admin/users/:id/quota
 *
 * Sets a user's cloud-save quota in bytes. Admin only. The column on the
 * Prisma User model is `cloudSaveQuotaBytes BigInt`; arktype validates the
 * incoming number against safe-integer bounds before we cast to BigInt for
 * the update. Returns the new value as a plain `number` so the UI doesn't
 * have to deal with BigInt JSON serialization.
 */
const Body = type({
  bytes: "0 <= number.integer <= 9007199254740992", // up to Number.MAX_SAFE_INTEGER
});

export default defineEventHandler(async (h3) => {
  const allowed = await aclManager.allowSystemACL(h3, ["user:write"]);
  if (!allowed) throw createError({ statusCode: 403 });

  const userId = getRouterParam(h3, "id");
  if (!userId)
    throw createError({
      statusCode: 400,
      statusMessage: "No userId in route.",
    });
  if (userId === "system")
    throw createError({
      statusCode: 400,
      statusMessage: "Cannot set quota on system user.",
    });

  const parsed = Body(await readBody(h3));
  if (parsed instanceof ArkErrors)
    throw createError({ statusCode: 400, statusMessage: parsed.summary });

  // Use updateMany + count check (per drop/no-prisma-delete lint rule) so a
  // missing user row surfaces as a clean 404 instead of an unhandled P2025.
  const result = await prisma.user.updateMany({
    where: { id: userId },
    data: { cloudSaveQuotaBytes: BigInt(parsed.bytes) },
  });
  if (result.count === 0) {
    throw createError({ statusCode: 404, statusMessage: "User not found." });
  }
  return { cloudSaveQuotaBytes: parsed.bytes };
});
