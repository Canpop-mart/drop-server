import { type } from "arktype";
import { readDropValidatedBody, throwingArktype } from "~/server/arktype";
import aclManager from "~/server/internal/acls";
import prisma from "~/server/internal/db/database";

const CreateRequest = type({
  title: "string",
  description: "string = ''",
  igdbUrl: "string | undefined",
  steamUrl: "string | undefined",
}).configure(throwingArktype);

export default defineEventHandler(async (h3) => {
  const userId = await aclManager.getUserIdACL(h3, ["store:read"]);
  if (!userId) throw createError({ statusCode: 403 });

  const body = await readDropValidatedBody(h3, CreateRequest);

  const request = await prisma.gameRequest.create({
    data: {
      title: body.title,
      description: body.description,
      igdbUrl: body.igdbUrl,
      steamUrl: body.steamUrl,
      requesterId: userId,
    },
  });

  return request;
});
