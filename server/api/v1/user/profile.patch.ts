import { type } from "arktype";
import { readDropValidatedBody, throwingArktype } from "~/server/arktype";
import aclManager from "~/server/internal/acls";
import prisma from "~/server/internal/db/database";

const UpdateProfile = type({
  displayName: "string | undefined",
  bio: "string | undefined",
  profileTheme: "string | undefined",
}).configure(throwingArktype);

export default defineEventHandler(async (h3) => {
  const userId = await aclManager.getUserIdACL(h3, ["read"]);
  if (!userId) throw createError({ statusCode: 403 });

  const body = await readDropValidatedBody(h3, UpdateProfile);

  const data: Record<string, string> = {};
  if (body.displayName !== undefined) data.displayName = body.displayName;
  if (body.bio !== undefined) data.bio = body.bio;
  if (body.profileTheme !== undefined) data.profileTheme = body.profileTheme;

  if (Object.keys(data).length === 0) {
    throw createError({ statusCode: 400, statusMessage: "No fields to update." });
  }

  const updated = await prisma.user.update({
    where: { id: userId },
    data,
  });

  return {
    id: updated.id,
    displayName: updated.displayName,
    bio: updated.bio,
    profileTheme: updated.profileTheme,
  };
});
