import { defineClientEventHandler } from "~/server/internal/clients/event-handler";
import {
  fetchUserQuota,
  fetchUserRevisionBytes,
  type CloudSaveQuota,
} from "~/server/internal/cloudsaves/quota";

/**
 * GET /api/v1/client/saves/quota
 *
 * Returns the calling user's cloud-save quota usage.
 *
 * Response: {
 *   usedBytes: number,     // sum of `size` across all non-tombstoned CloudSave rows
 *   limitBytes: number,    // from User.cloudSaveQuotaBytes
 *   revisionBytes: number, // storage held by version history, NOT counted in usedBytes
 * }
 *
 * `usedBytes` excludes tombstoned rows so the figure matches the user's
 * mental model ("what I have in the cloud right now"). Numbers are serialised
 * as plain `number`s; quotas above 2^53 bytes (~9 PB) would lose precision
 * but are well outside any plausible drop deployment.
 *
 * `revisionBytes` is reported separately rather than folded into `usedBytes`
 * because history doesn't count against the cap — see `fetchUserRevisionBytes`
 * for that decision. It's here so the number is visible instead of invisible.
 */
export default defineClientEventHandler(
  async (
    h3,
    { fetchUser },
  ): Promise<CloudSaveQuota & { revisionBytes: number }> => {
    const user = await fetchUser();
    const [quota, revisionBytes] = await Promise.all([
      fetchUserQuota(user.id),
      fetchUserRevisionBytes(user.id),
    ]);
    return { ...quota, revisionBytes };
  },
);
