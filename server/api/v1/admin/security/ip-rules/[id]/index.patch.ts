/**
 * PATCH /api/v1/admin/security/ip-rules/:id
 *
 * Updates a rule's `enabled` flag and/or `notes`. The rule's `kind` and
 * `pattern` are immutable here by design — changing what an existing rule
 * matches is a delete-then-create operation, which keeps the audit trail
 * (createdBy / createdAt) honest.
 *
 * Body: { enabled?: boolean, notes?: string } — at least one field.
 *
 * Lockout guard: toggling a rule changes the effective rule set, so the
 * post-change set is simulated and the requesting admin's IP re-checked.
 * Enabling a Deny that matches the admin, or disabling the lone Allow that
 * was admitting them, is rejected with 409.
 *
 * Admin-only (session-authenticated admin).
 */

import { type } from "arktype";
import { readDropValidatedBody, throwingArktype } from "~/server/arktype";
import aclManager from "~/server/internal/acls";
import prisma from "~/server/internal/db/database";
import {
  type IpRuleLike,
  getIpRules,
  isIpAdmitted,
  reloadIpRules,
  resolveClientIp,
} from "~/server/internal/security/ipRules";
import { serializeIpRule } from "~/server/internal/security/serialize";
import type { SerializedIpRule } from "~/server/internal/security/types";

const UpdateIpRule = type({
  "enabled?": "boolean",
  "notes?": "string",
}).configure(throwingArktype);

// Loopback is never filtered, so a guard check from the host can't trip.
const LOOPBACK_IPS = new Set(["127.0.0.1", "::1"]);

export default defineEventHandler(async (h3): Promise<SerializedIpRule> => {
  const allowed = await aclManager.allowSystemACL(h3, []);
  if (!allowed) throw createError({ statusCode: 403 });

  const id = h3.context.params?.id;
  if (!id)
    throw createError({
      statusCode: 400,
      statusMessage: "Missing IP rule ID",
    });

  const body = await readDropValidatedBody(h3, UpdateIpRule);
  if (body.enabled === undefined && body.notes === undefined) {
    throw createError({
      statusCode: 400,
      statusMessage: "Provide at least one of: enabled, notes.",
    });
  }

  const existing = await prisma.ipRule.findUnique({ where: { id } });
  if (!existing)
    throw createError({ statusCode: 404, statusMessage: "IP rule not found" });

  // Lockout guard — only relevant when the `enabled` flag actually changes,
  // since `notes` cannot affect matching.
  if (body.enabled !== undefined && body.enabled !== existing.enabled) {
    const clientIp = resolveClientIp(h3);
    if (!LOOPBACK_IPS.has(clientIp)) {
      const currentRules = await getIpRules();
      // Simulate by swapping this rule's enabled flag in the live set.
      const simulated: IpRuleLike[] = currentRules.map((r) =>
        r.pattern === existing.pattern && r.kind === existing.kind
          ? { ...r, enabled: body.enabled! }
          : r,
      );
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
  }

  const rule = await prisma.ipRule.update({
    where: { id },
    data: {
      ...(body.enabled !== undefined && { enabled: body.enabled }),
      ...(body.notes !== undefined && { notes: body.notes.trim() || null }),
    },
    include: {
      createdByUser: {
        select: { id: true, username: true, displayName: true },
      },
    },
  });

  await reloadIpRules();

  return serializeIpRule(rule);
});
