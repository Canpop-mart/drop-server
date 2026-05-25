import { defineClientEventHandler } from "~/server/internal/clients/event-handler";
import {
  fetchUserQuota,
  type CloudSaveQuota,
} from "~/server/internal/cloudsaves/quota";

/**
 * GET /api/v1/client/saves/quota
 *
 * Returns the calling user's cloud-save quota usage.
 *
 * Response: {
 *   usedBytes: number,   // sum of `size` across all non-tombstoned CloudSave rows
 *   limitBytes: number,  // from User.cloudSaveQuotaBytes
 * }
 *
 * `usedBytes` excludes tombstoned rows so the figure matches the user's
 * mental model ("what I have in the cloud right now"). Numbers are serialised
 * as plain `number`s; quotas above 2^53 bytes (~9 PB) would lose precision
 * but are well outside any plausible drop deployment.
 */
export default defineClientEventHandler(
  async (h3, { fetchUser }): Promise<CloudSaveQuota> => {
    const user = await fetchUser();
    return await fetchUserQuota(user.id);
  },
);
