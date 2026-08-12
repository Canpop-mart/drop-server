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
 * STRICTLY PER USER, and deliberately out of step with the read endpoints.
 * `list` / `sync-check` / `download` let any account read any account's
 * namespaced PC saves (`internal/cloudsaves/scope.ts`), but deleting is a
 * write and only ever touches the caller's own row.
 *
 * `id` therefore identifies the SAVE, not the row to tombstone. The read
 * endpoints hand the client the winner of a filename collision, which can
 * belong to another account; scoping the update to `{ id, userId }` then
 * matched nothing and the user was told "Save not found" while their own copy
 * sat there untouched. So we resolve `(gameId, filename)` from whatever row
 * the client names and tombstone the caller's own row for that filename.
 *
 * The consequence is unchanged and the client UI states it: deleting a shared
 * PC save removes your copy only, and if another account still holds an active
 * row for that filename the save reappears on a later sync.
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
    },
  });

  if (result.count === 0) {
    const exists = await prisma.cloudSave.findUnique({
      where: { gameId_userId_filename: own },
      select: { deletedAt: true },
    });
    // Already gone: report success so retries are idempotent.
    if (exists) return { deleted: true, alreadyTombstoned: true };
    // The caller has no copy of this filename — they were looking at somebody
    // else's row. Not an error, and specifically not "Save not found": there
    // is simply nothing of theirs to delete, and saying so is the only honest
    // answer given the dialog promised to remove their copy only.
    return { deleted: false, noOwnedCopy: true };
  }

  return { deleted: true };
});
