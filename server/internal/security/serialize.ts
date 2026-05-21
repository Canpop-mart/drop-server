/*
 * Converts a Prisma IpRule row (with its `createdByUser` joined in) into
 * the JSON-friendly `SerializedIpRule` wire shape.
 *
 * The only real transform is `createdAt`: Prisma yields a `Date`, but the
 * HTTP response carries an ISO string. Doing the conversion explicitly —
 * rather than relying on H3's implicit Date serialisation — keeps the
 * endpoint's declared return type honest, so the admin UI infers a
 * `string` and not a `Date`.
 */

import type { IpRuleKind } from "~/prisma/client/enums";
import type { SerializedIpRule } from "./types";

/** The Prisma row shape this serialiser accepts. */
interface IpRuleRow {
  id: string;
  kind: IpRuleKind;
  pattern: string;
  notes: string | null;
  enabled: boolean;
  createdAt: Date;
  createdByUserId: string;
  createdByUser: {
    id: string;
    username: string;
    displayName: string;
  };
}

export function serializeIpRule(rule: IpRuleRow): SerializedIpRule {
  return {
    id: rule.id,
    kind: rule.kind,
    pattern: rule.pattern,
    notes: rule.notes,
    enabled: rule.enabled,
    createdAt: rule.createdAt.toISOString(),
    createdByUserId: rule.createdByUserId,
    createdByUser: {
      id: rule.createdByUser.id,
      username: rule.createdByUser.username,
      displayName: rule.createdByUser.displayName,
    },
  };
}
