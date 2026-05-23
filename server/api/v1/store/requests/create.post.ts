import { type } from "arktype";
import { readDropValidatedBody, throwingArktype } from "~/server/arktype";
import aclManager from "~/server/internal/acls";
import prisma from "~/server/internal/db/database";

// arktype: `"key?": "type"` makes the property *truly* optional (can be
// absent from the body). The previous `"key": "string | undefined"`
// shape required the key to be present, which silently 400'd the
// request whenever the page omitted `igdbUrl` — the dialog never sent it
// and there's no `.catch()` on the client, so the user just saw "nothing
// happens." Optional with a string type is what we actually want.
const CreateRequest = type({
  title: "string",
  description: "string = ''",
  "igdbUrl?": "string",
  "steamUrl?": "string",
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
