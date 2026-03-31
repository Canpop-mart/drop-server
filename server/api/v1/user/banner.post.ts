import aclManager from "~/server/internal/acls";
import prisma from "~/server/internal/db/database";
import { handleFileUpload } from "~/server/internal/utils/handlefileupload";

export default defineEventHandler(async (h3) => {
  const userId = await aclManager.getUserIdACL(h3, ["object:update"]);
  if (!userId) throw createError({ statusCode: 403 });

  const uploadResult = await handleFileUpload(h3, {}, ["internal:read"], 1);
  if (!uploadResult) {
    throw createError({
      statusCode: 400,
      statusMessage: "Failed to upload banner.",
    });
  }

  const [imageIds, _options, pull, _dump] = uploadResult;
  const bannerId = imageIds.at(0);
  if (!bannerId) {
    throw createError({ statusCode: 400, statusMessage: "No image provided." });
  }

  const updated = await prisma.user.updateMany({
    where: { id: userId },
    data: { bannerObjectId: bannerId },
  });
  if (updated.count === 0)
    throw createError({ statusCode: 404, statusMessage: "User not found." });

  await pull();

  return { bannerObjectId: bannerId };
});
