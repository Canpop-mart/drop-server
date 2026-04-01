import { type } from "arktype";
import { readDropValidatedBody, throwingArktype } from "~/server/arktype";
import aclManager from "~/server/internal/acls";
import prisma from "~/server/internal/db/database";

const CreateReview = type({
  rating: "1 | 2 | 3 | 4 | 5",
  body: "string = ''",
}).configure(throwingArktype);

export default defineEventHandler(async (h3) => {
  const userId = await aclManager.getUserIdACL(h3, ["store:read"]);
  if (!userId) throw createError({ statusCode: 403 });
  const gameId = getRouterParam(h3, "id");
  if (!gameId)
    throw createError({ statusCode: 400, statusMessage: "Missing game ID" });
  const body = await readDropValidatedBody(h3, CreateReview);

  const review = await prisma.gameReview.upsert({
    where: { gameId_userId: { gameId, userId } },
    update: { rating: body.rating, body: body.body },
    create: { gameId, userId, rating: body.rating, body: body.body },
    include: {
      user: {
        select: {
          id: true,
          username: true,
          displayName: true,
          profilePictureObjectId: true,
        },
      },
    },
  });

  return review;
});
