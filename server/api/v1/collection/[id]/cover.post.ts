import aclManager from "~/server/internal/acls";
import prisma from "~/server/internal/db/database";
import { handleFileUpload } from "~/server/internal/utils/handlefileupload";

/**
 * Upload a cover/banner image for a collection (used on the store landing page
 * and the store-home shelf card). Owner-scoped. Mirrors the avatar/banner
 * upload flow — persist the object bytes first, then point the row at the new
 * id, so a decode failure leaves the old cover in place.
 */
export default defineEventHandler(async (h3) => {
  const userId = await aclManager.getUserIdACL(h3, ["collections:add"]);
  if (!userId) throw createError({ statusCode: 403 });

  const id = getRouterParam(h3, "id");
  if (!id) throw createError({ statusCode: 400, statusMessage: "Missing ID" });

  // Confirm ownership before accepting an upload so we never persist an
  // object the caller can't attach.
  const owned = await prisma.collection.findFirst({
    where: { id, userId },
    select: { id: true },
  });
  if (!owned)
    throw createError({
      statusCode: 404,
      statusMessage: "Collection not found",
    });

  const uploadResult = await handleFileUpload(
    h3,
    {},
    ["internal:read"],
    1,
    "gameImage",
  );
  if (!uploadResult)
    throw createError({ statusCode: 400, statusMessage: "Failed to upload." });

  const [imageIds, _options, pull] = uploadResult;
  const coverId = imageIds.at(0);
  if (!coverId)
    throw createError({ statusCode: 400, statusMessage: "No image provided." });

  try {
    await pull();
  } catch (e) {
    throw createError({
      statusCode: 400,
      statusMessage: "Couldn't process cover image.",
      message: e instanceof Error ? e.message : String(e),
    });
  }

  await prisma.collection.updateMany({
    where: { id, userId },
    data: { coverObjectId: coverId },
  });
  return { coverObjectId: coverId };
});
