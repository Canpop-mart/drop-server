import { type } from "arktype";
import { readDropValidatedBody, requireRouterParam, throwingArktype } from "~/server/arktype";
import aclManager from "~/server/internal/acls";
import prisma from "~/server/internal/db/database";

const CompanyUpdate = type({
  mName: "string?",
  mShortDescription: "string?",
  mDescription: "string?",
  mLogoObjectId: "string?",
  mBannerObjectId: "string?",
  mWebsite: "string?",
}).configure(throwingArktype);

export default defineEventHandler(async (h3) => {
  const allowed = await aclManager.allowSystemACL(h3, ["company:update"]);
  if (!allowed) throw createError({ statusCode: 403 });

  const id = requireRouterParam(h3, "id");

  const body = await readDropValidatedBody(h3, CompanyUpdate);

  const [newObj] = await prisma.company.updateManyAndReturn({
    where: { id },
    data: body,
  });
  if (!newObj)
    throw createError({ statusCode: 404, message: "Company not found" });

  return newObj;
});
