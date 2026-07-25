import { type } from "arktype";
import { GameType } from "~/prisma/client/enums";
import {
  readDropValidatedBody,
  requireRouterParam,
  throwingArktype,
} from "~/server/arktype";
import aclManager from "~/server/internal/acls";
import prisma from "~/server/internal/db/database";

const GameUpdate = type({
  mName: "string?",
  mShortDescription: "string?",
  mDescription: "string?",
  mIconObjectId: "string?",
  mBannerObjectId: "string?",
  mCoverObjectId: "string?",
  mLogoObjectId: "string?",
  featured: "boolean?",
  // For type=Mod games: the base game this mod applies to. A string sets the
  // parent, null clears it, and an absent key leaves it unchanged.
  "parentGameId?": "string | null",
}).configure(throwingArktype);

export default defineEventHandler(async (h3) => {
  const allowed = await aclManager.allowSystemACL(h3, ["game:update"]);
  if (!allowed) throw createError({ statusCode: 403 });

  const id = requireRouterParam(h3, "id");

  const body = await readDropValidatedBody(h3, GameUpdate);

  // Setting a parent: it must exist, be a base game (not a mod/dependency),
  // and not be the game itself. Clearing it (null) needs no check.
  if (typeof body.parentGameId === "string") {
    if (body.parentGameId === id)
      throw createError({
        statusCode: 400,
        message: "A game cannot be its own parent.",
      });
    const parent = await prisma.game.findUnique({
      where: { id: body.parentGameId },
      select: { type: true },
    });
    if (!parent)
      throw createError({ statusCode: 400, message: "Parent game not found." });
    if (parent.type !== GameType.Game)
      throw createError({
        statusCode: 400,
        message: "Parent must be a base game, not a mod or dependency.",
      });
  }

  const [newObj] = await prisma.game.updateManyAndReturn({
    where: { id },
    data: body,
  });
  if (!newObj)
    throw createError({ statusCode: 404, message: "Game not found" });

  return newObj;
});
