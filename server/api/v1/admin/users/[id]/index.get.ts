import aclManager from "~/server/internal/acls";
import prisma from "~/server/internal/db/database";

export default defineEventHandler(async (h3) => {
  const allowed = await aclManager.allowSystemACL(h3, ["user:read"]);
  if (!allowed) throw createError({ statusCode: 403 });

  const userId = getRouterParam(h3, "id");
  if (!userId)
    throw createError({
      statusCode: 400,
      statusMessage: "No userId in route.",
    });

  if (userId == "system")
    throw createError({
      statusCode: 400,
      statusMessage: "Cannot delete system user.",
    });

  // Explicit select to prevent leaking sensitive relations (authMecs.credentials,
  // mfas.credentials, tokens.token) if the User model grows new fields in the future.
  // Admin tooling only needs the user's profile + admin status; credentials live in
  // linkedAuthMec / linkedMFAMec and are accessed via their own dedicated endpoints.
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      username: true,
      displayName: true,
      email: true,
      admin: true,
      enabled: true,
      profilePictureObjectId: true,
      bannerObjectId: true,
      bio: true,
      profileTheme: true,
      cloudSaveQuotaBytes: true,
    },
  });
  if (!user)
    throw createError({ statusCode: 404, statusMessage: "User not found." });

  // BigInt doesn't survive default JSON serialization; cast to number for the
  // wire. Range is bounded by the POST endpoint (≤ Number.MAX_SAFE_INTEGER),
  // so the round-trip is lossless.
  return {
    ...user,
    cloudSaveQuotaBytes: Number(user.cloudSaveQuotaBytes),
  };
});
