import { type } from "arktype";
import { readDropValidatedBody, throwingArktype } from "~/server/arktype";
import aclManager from "~/server/internal/acls";
import prisma from "~/server/internal/db/database";
import { validateProfilePatch } from "~/server/internal/userprofile/limits";

const UpdateProfile = type({
  displayName: "string | undefined",
  bio: "string | undefined",
  profileTheme: "string | undefined",
}).configure(throwingArktype);

export default defineEventHandler(async (h3) => {
  const userId = await aclManager.getUserIdACL(h3, ["profile:update"]);
  if (!userId) throw createError({ statusCode: 403 });

  const body = await readDropValidatedBody(h3, UpdateProfile);

  if (
    body.displayName === undefined &&
    body.bio === undefined &&
    body.profileTheme === undefined
  ) {
    throw createError({
      statusCode: 400,
      statusMessage: "No fields to update.",
    });
  }

  const stored = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, displayName: true, bio: true, profileTheme: true },
  });
  if (!stored)
    throw createError({ statusCode: 404, statusMessage: "User not found." });

  const checked = validateProfilePatch(body, stored);
  if ("error" in checked)
    throw createError({ statusCode: 400, statusMessage: checked.error });
  const { data } = checked;

  // Everything sent matches what is stored: nothing to write.
  if (Object.keys(data).length === 0) return stored;

  const updated = (
    await prisma.user.updateManyAndReturn({
      where: { id: userId },
      data,
    })
  ).at(0);

  if (!updated)
    throw createError({ statusCode: 404, statusMessage: "User not found." });

  return {
    id: updated.id,
    displayName: updated.displayName,
    bio: updated.bio,
    profileTheme: updated.profileTheme,
  };
});
