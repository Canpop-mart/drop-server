import { defineClientEventHandler } from "~/server/internal/clients/event-handler";
import prisma from "~/server/internal/db/database";

/**
 * Soft-delete a cloud save.
 *
 * Body: { id, deletedFrom?: string, uploadedFrom?: string }
 *
 * The row is NOT removed; instead `deletedAt` is set to now and `deletedFrom`
 * is recorded so other devices can see "this save was deleted from <device>"
 * during their next sync-check (see sync-check's `tombstones` array). A 30-day
 * GC sweep — see `internal/cloudsaves/quota.ts#gcTombstones` — eventually
 * hard-deletes old tombstones.
 *
 * `deletedFrom` is sourced in priority order:
 *   1. `body.deletedFrom`     — modern clients sending the canonical key.
 *   2. `body.uploadedFrom`    — Rust desktop client's `DeleteBody` uses
 *                               `uploaded_from` (camelCased to `uploadedFrom`)
 *                               because the field doubles as the "deleted
 *                               by this device" hint. Accept it as a synonym
 *                               so the cross-device "deleted from <X>"
 *                               surface actually works for those clients.
 *   3. `X-Drop-Hostname`      — legacy header set by older clients.
 *   4. Empty string           — we still tombstone; the cascade is what
 *                               matters and the hint is just a UX nicety.
 *
 * Re-uploads automatically clear the tombstone (see upload / bulk-upload).
 */
export default defineClientEventHandler(async (h3, { fetchUser }) => {
  const user = await fetchUser();
  const userId = user.id;

  const body = await readBody(h3);
  const {
    id,
    deletedFrom: bodyDeletedFrom,
    uploadedFrom: bodyUploadedFrom,
  } = body ?? {};
  if (!id) throw createError({ statusCode: 400, statusMessage: "id required" });

  const headerHost = getHeader(h3, "x-drop-hostname") ?? "";
  const deletedFrom = (
    bodyDeletedFrom ||
    bodyUploadedFrom ||
    headerHost ||
    ""
  ).slice(0, 255);

  // Two-step: only tombstone rows owned by this user, and only ones that
  // aren't already tombstoned (so we don't churn the deletedAt timestamp
  // when a client retries a delete). `updateMany` is required by the
  // repo's `drop/no-prisma-delete` lint rule and gives us a rowcount we
  // can turn into a clean 404.
  const result = await prisma.cloudSave.updateMany({
    where: { id, userId, deletedAt: null },
    data: {
      deletedAt: new Date(),
      deletedFrom,
    },
  });

  if (result.count === 0) {
    // Either the row doesn't exist, doesn't belong to the user, or was
    // already tombstoned. Distinguish "already gone" from "404" so retries
    // are idempotent.
    const exists = await prisma.cloudSave.findFirst({
      where: { id, userId },
      select: { id: true, deletedAt: true },
    });
    if (exists && exists.deletedAt !== null) {
      return { deleted: true, alreadyTombstoned: true };
    }
    throw createError({ statusCode: 404, statusMessage: "Save not found" });
  }

  return { deleted: true };
});
