import aclManager from "~/server/internal/acls";
import prisma from "~/server/internal/db/database";
import {
  handleFileUpload,
  PROFILE_IMAGE_MIME_TYPES,
} from "~/server/internal/utils/handlefileupload";

export default defineEventHandler(async (h3) => {
  const userId = await aclManager.getUserIdACL(h3, ["object:update"]);
  if (!userId) throw createError({ statusCode: 403 });

  const uploadResult = await handleFileUpload(
    h3,
    {},
    ["internal:read"],
    1,
    "profileBanner",
    PROFILE_IMAGE_MIME_TYPES,
  );
  if (!uploadResult) {
    throw createError({
      statusCode: 400,
      statusMessage: "Failed to upload banner.",
    });
  }

  const [imageIds, _options, pull, dump] = uploadResult;
  const bannerId = imageIds.at(0);
  if (!bannerId) {
    throw createError({ statusCode: 400, statusMessage: "No image provided." });
  }

  // Store the image BEFORE pointing the user row at it, as avatar.post.ts
  // does: a failed store used to leave bannerObjectId naming an object that
  // was never written.
  try {
    await pull();
  } catch (e) {
    throw createError({
      statusCode: 400,
      statusMessage: "Couldn't process banner image.",
      message: e instanceof Error ? e.message : String(e),
    });
  }

  const updated = await prisma.user.updateMany({
    where: { id: userId },
    data: { bannerObjectId: bannerId },
  });
  if (updated.count === 0) {
    // Drop the object stored above; nothing points at it.
    await dump();
    throw createError({ statusCode: 404, statusMessage: "User not found." });
  }

  return { bannerObjectId: bannerId };
});
