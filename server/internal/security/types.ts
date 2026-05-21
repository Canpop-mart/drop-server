/*
 * Shared wire-shape types for the IP allowlist / blocklist feature.
 *
 * The admin endpoints and the admin UI both need to agree on the shape of
 * an IP rule as it travels over HTTP. Annotating the endpoints with these
 * types (rather than letting Prisma's `Date`-typed model leak out) gives
 * the frontend an accurate inferred type: `$dropFetch` JSON-serialises the
 * response, so `createdAt` arrives as an ISO string, not a `Date`.
 */

import type { IpRuleKind } from "~/prisma/client/enums";

/** The creating user, as joined into a rule response. */
export interface IpRuleCreator {
  id: string;
  username: string;
  displayName: string;
}

/** An IP rule as returned by the admin endpoints (JSON-serialised). */
export interface SerializedIpRule {
  id: string;
  kind: IpRuleKind;
  pattern: string;
  notes: string | null;
  enabled: boolean;
  /** ISO 8601 timestamp. */
  createdAt: string;
  createdByUserId: string;
  createdByUser: IpRuleCreator;
}

/** Response body of GET /api/v1/admin/security/ip-rules. */
export interface IpRulesListResponse {
  /** The IP the requesting admin is connecting from. */
  currentIp: string;
  /** All rules, newest first. */
  rules: SerializedIpRule[];
}
