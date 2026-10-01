import { defineClientEventHandler } from "~/server/internal/clients/event-handler";
import prisma from "~/server/internal/db/database";
import { isReadableSave } from "~/server/internal/cloudsaves/scope";

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
 *
 * `deletedFromClientId` is the authenticated client making this request. It
 * is what devices match their own tombstones on (the name above is only for
 * display), because a device name can be renamed or shared.
 *
 * Strictly per user, like every save endpoint (`internal/cloudsaves/scope.ts`):
 * `id` must name one of the caller's own rows, and only that row is
 * tombstoned. The `noOwnedCopy` answer below is unreachable now and kept only
 * so the response shape older clients parse stays defined.
 */
export default defineClientEventHandler(async (h3, { fetchUser, clientId }) => {
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

  // Which save is this, and is the caller allowed to see it at all? A row the
  // caller cannot read is a 404 rather than a 403, so the endpoint doesn't
  // confirm the id exists.
  const target = await prisma.cloudSave.findUnique({
    where: { id },
    select: { gameId: true, userId: true, saveType: true, filename: true },
  });
  if (!target || !isReadableSave(target, userId)) {
    throw createError({ statusCode: 404, statusMessage: "Save not found" });
  }

  const own = { gameId: target.gameId, userId, filename: target.filename };

  // Only tombstone rows that aren't already tombstoned, so a retried delete
  // doesn't churn the `deletedAt` timestamp. `updateMany` is required by the
  // repo's `drop/no-prisma-delete` lint rule and gives us a rowcount.
  const result = await prisma.cloudSave.updateMany({
    where: { ...own, deletedAt: null },
    data: {
      deletedAt: new Date(),
      deletedFrom,
      deletedFromClientId: clientId,
    },
  });

  if (result.count === 0) {
    const exists = await prisma.cloudSave.findUnique({
      where: { gameId_userId_filename: own },
      select: { deletedAt: true },
    });
    // Already gone: report success so retries are idempotent.
    if (exists) return { deleted: true, alreadyTombstoned: true };
    // Unreachable while reads are per user (the lookup above already 404s a
    // row that is not the caller's), kept so the answer stays well defined.
    return { deleted: false, noOwnedCopy: true };
  }

  return { deleted: true };
});
