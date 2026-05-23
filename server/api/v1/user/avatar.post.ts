import aclManager from "~/server/internal/acls";
import prisma from "~/server/internal/db/database";
import { handleFileUpload } from "~/server/internal/utils/handlefileupload";

export default defineEventHandler(async (h3) => {
  const userId = await aclManager.getUserIdACL(h3, ["object:update"]);
  if (!userId) throw createError({ statusCode: 403 });

  const uploadResult = await handleFileUpload(
    h3,
    {},
    ["internal:read"],
    1,
    "profileAvatar",
  );
  if (!uploadResult) {
    throw createError({
      statusCode: 400,
      statusMessage: "Failed to upload avatar.",
    });
  }

  const [imageIds, _options, pull, _dump] = uploadResult;
  const avatarId = imageIds.at(0);
  if (!avatarId) {
    throw createError({ statusCode: 400, statusMessage: "No image provided." });
  }

  // Persist the avatar bytes BEFORE pointing the user row at the new id.
  // `pull()` is what actually drives ObjectHandler.createFromSource — if
  // the upload is malformed (no detectable MIME, empty buffer, decode
  // failure) it throws here, and the old profilePictureObjectId stays in
  // place. Previously this ran *after* the DB update, which meant any
  // failure left the user's profile pointing at an id that was never
  // written — every subsequent avatar render then crashed.
  try {
    await pull();
  } catch (e) {
    throw createError({
      statusCode: 400,
      statusMessage: "Couldn't process avatar image.",
      message: e instanceof Error ? e.message : String(e),
    });
  }

  const updated = await prisma.user.updateMany({
    where: { id: userId },
    data: { profilePictureObjectId: avatarId },
  });
  if (updated.count === 0)
    throw createError({ statusCode: 404, statusMessage: "User not found." });

  return { profilePictureObjectId: avatarId };
});
