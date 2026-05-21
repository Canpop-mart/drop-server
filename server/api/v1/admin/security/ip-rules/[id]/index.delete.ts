/**
 * DELETE /api/v1/admin/security/ip-rules/:id
 *
 * Removes an IP allowlist / blocklist rule. The middleware rule cache is
 * refreshed afterwards so the change applies on the next request without
 * a server restart.
 *
 * Deleting a rule can only ever WIDEN access (it removes a constraint), so
 * — unlike create — there is no lockout to guard against here.
 *
 * Admin-only (session-authenticated admin).
 */

import aclManager from "~/server/internal/acls";
import prisma from "~/server/internal/db/database";
import { reloadIpRules } from "~/server/internal/security/ipRules";

export default defineEventHandler(async (h3) => {
  const allowed = await aclManager.allowSystemACL(h3, []);
  if (!allowed) throw createError({ statusCode: 403 });

  const id = h3.context.params?.id;
  if (!id)
    throw createError({
      statusCode: 400,
      statusMessage: "Missing IP rule ID",
    });

  const { count } = await prisma.ipRule.deleteMany({ where: { id } });
  if (count === 0)
    throw createError({ statusCode: 404, statusMessage: "IP rule not found" });

  await reloadIpRules();

  return { success: true };
});
