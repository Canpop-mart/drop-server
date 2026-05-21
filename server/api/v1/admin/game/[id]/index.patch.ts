import { type } from "arktype";
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
  // Per-game override for the GBE auto-swap policy. null → inherit
  // the library setting; true/false → force-on / force-off for this
  // game regardless of the library default. See gbe.ts → ensureGbeDll.
  autoSwapSteamApiDll: "boolean | null | undefined",
}).configure(throwingArktype);

export default defineEventHandler(async (h3) => {
  const allowed = await aclManager.allowSystemACL(h3, ["game:update"]);
  if (!allowed) throw createError({ statusCode: 403 });

  const id = requireRouterParam(h3, "id");

  const body = await readDropValidatedBody(h3, GameUpdate);

  const [newObj] = await prisma.game.updateManyAndReturn({
    where: { id },
    data: body,
  });
  if (!newObj)
    throw createError({ statusCode: 404, message: "Game not found" });

  return newObj;
});
