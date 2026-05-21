/**
 * POST /api/v1/admin/security/ip-rules
 *
 * Creates an IP allowlist / blocklist rule.
 *
 * Body: { kind: "Allow" | "Deny", pattern: string, notes?: string }
 *
 * The `pattern` must parse as a bare IPv4/IPv6 address or a CIDR range;
 * anything else is rejected with 400 before it touches the database.
 *
 * Lockout guard: before persisting, the post-change rule set is simulated
 * and the requesting admin's own IP is checked against it. If the new rule
 * would lock the admin out, the request is rejected with 409 so they
 * cannot accidentally fence themselves off the server. Localhost is exempt
 * from the filter, so an operator working from the host itself can always
 * recover regardless.
 *
 * Admin-only (session-authenticated admin).
 */

import { type } from "arktype";
import { IpRuleKind } from "~/prisma/client/enums";
import { readDropValidatedBody, throwingArktype } from "~/server/arktype";
import aclManager from "~/server/internal/acls";
import prisma from "~/server/internal/db/database";
import { isValidIpRulePattern } from "~/server/internal/utils/ipMatch";
import {
  type IpRuleLike,
  getIpRules,
  isIpAdmitted,
  reloadIpRules,
  resolveClientIp,
} from "~/server/internal/security/ipRules";
import { serializeIpRule } from "~/server/internal/security/serialize";
import type { SerializedIpRule } from "~/server/internal/security/types";

const CreateIpRule = type({
  kind: "'Allow' | 'Deny'",
  pattern: "string > 0",
  "notes?": "string",
}).configure(throwingArktype);

// Loopback addresses are never filtered (see the ip-filter middleware), so
// a guard check from the host itself can never trip.
const LOOPBACK_IPS = new Set(["127.0.0.1", "::1"]);

export default defineEventHandler(async (h3): Promise<SerializedIpRule> => {
  const allowed = await aclManager.allowSystemACL(h3, []);
  if (!allowed) throw createError({ statusCode: 403 });

  // The rule must be attributed to a real user (createdByUserId FK), so
  // this endpoint is session-only — an API token has no acting user here.
  const userId = await aclManager.getUserIdACL(h3, []);
  if (!userId) throw createError({ statusCode: 403 });

  const body = await readDropValidatedBody(h3, CreateIpRule);

  const pattern = body.pattern.trim();
  if (!isValidIpRulePattern(pattern)) {
    throw createError({
      statusCode: 400,
      statusMessage:
        "Pattern must be a valid IPv4/IPv6 address or CIDR range (e.g. 192.168.1.0/24).",
    });
  }

  const kind = body.kind === "Allow" ? IpRuleKind.Allow : IpRuleKind.Deny;

  // Lockout guard — simulate the rule set as it would be after this insert
  // and confirm the requesting admin would still be admitted.
  const clientIp = resolveClientIp(h3);
  if (!LOOPBACK_IPS.has(clientIp)) {
    const currentRules = await getIpRules();
    const simulated: IpRuleLike[] = [
      ...currentRules,
      { kind, pattern, enabled: true },
    ];
    if (!isIpAdmitted(clientIp, simulated)) {
      throw createError({
        statusCode: 409,
        data: {
          error:
            "Saving this rule would lock you out. Add an Allow rule for your IP first.",
        },
        statusMessage:
          "Saving this rule would lock you out. Add an Allow rule for your IP first.",
      });
    }
  }

  const rule = await prisma.ipRule.create({
    data: {
      kind,
      pattern,
      notes: body.notes?.trim() || null,
      createdByUserId: userId,
    },
    include: {
      createdByUser: {
        select: { id: true, username: true, displayName: true },
      },
    },
  });

  // Refresh the middleware cache so the new rule takes effect immediately.
  await reloadIpRules();

  return serializeIpRule(rule);
});
