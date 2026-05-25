/**
 * Make BigInt safe for `JSON.stringify`.
 *
 * Nitro's default response serializer uses `JSON.stringify`, which throws
 * `TypeError: Do not know how to serialize a BigInt`. Prisma's `BigInt`-
 * typed columns (User.cloudSaveQuotaBytes today; likely others later)
 * surface raw BigInt values in handler return objects, so any endpoint
 * returning a User row 500s once such a column exists.
 *
 * We define `BigInt.prototype.toJSON` so `JSON.stringify` calls it
 * automatically. `Number(this)` is lossy past `Number.MAX_SAFE_INTEGER`
 * (2^53 - 1), but every BigInt we currently persist is bounded well below
 * that — `cloudSaveQuotaBytes` is validated ≤ MAX_SAFE_INTEGER in the
 * admin POST endpoint, and Prisma keeps it ≥ 0. If we ever need numbers
 * past 2^53, switch the toJSON to `this.toString()` and update consumers
 * that destructure it as `number`.
 *
 * Numbered `00.` so it runs before any handler that might invoke
 * `JSON.stringify` on its own.
 */
export default defineNitroPlugin(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (BigInt.prototype as any).toJSON = function () {
    return Number(this);
  };
});
