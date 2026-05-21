/**
 * GET /api/v1/admin/security/ip-rules
 *
 * Lists every IP allowlist / blocklist rule, newest first, for the admin
 * security settings page (pages/admin/settings/security.vue).
 *
 * Also returns `currentIp` — the IP the requesting admin is connecting
 * from — so the UI can show it at the top of the page and pre-fill the
 * "add an Allow rule for my IP" suggestion when a save is rejected by the
 * lockout guard.
 *
 * Admin-only: gated on a session-authenticated admin (same `allowSystemACL`
 * pattern as the other server/api/v1/admin/security routes).
 */

import aclManager from "~/server/internal/acls";
import prisma from "~/server/internal/db/database";
import { resolveClientIp } from "~/server/internal/security/ipRules";
import { serializeIpRule } from "~/server/internal/security/serialize";
import type { IpRulesListResponse } from "~/server/internal/security/types";

export default defineEventHandler(
  async (h3): Promise<IpRulesListResponse> => {
    const allowed = await aclManager.allowSystemACL(h3, []);
    if (!allowed) throw createError({ statusCode: 403 });

    const rules = await prisma.ipRule.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        createdByUser: {
          select: { id: true, username: true, displayName: true },
        },
      },
    });

    return {
      currentIp: resolveClientIp(h3),
      rules: rules.map(serializeIpRule),
    };
  },
);
