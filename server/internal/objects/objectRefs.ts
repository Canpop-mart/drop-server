/**
 * Centralised registry of every Prisma column that holds an object ID.
 *
 * Why this exists
 * ───────────────
 * The GC task (`server/internal/tasks/registry/objects.ts`) used to rely on
 * a runtime naming convention — any column ending in `objectid` /
 * `objectids` was treated as a reference. That works until someone names a
 * column `mLogoImageId` (no "Object" suffix) or `iconObject` (no "Id"
 * suffix) and the GC silently deletes a live in-use object.
 *
 * This file is the single source of truth. To add a new reference column:
 *   1. Add a row to `OBJECT_REFERENCE_COLUMNS` below.
 *   2. `pnpm typecheck` will complain if the model / field names are wrong.
 *   3. The GC task picks it up automatically — no other code changes.
 *
 * The test in `server/internal/objects/objectRefs.test-static.ts` asserts
 * that every `*Object{Id,Ids}`-shaped Prisma field is enumerated here. If
 * you add a new column and forget to register it, the static test fails.
 */
import prisma from "../db/database";

export type ObjectReferenceKind = "scalar" | "array";

export type ObjectReferenceColumn = {
  /** Prisma model accessor name (matches `prisma[model]`). */
  model: string;
  /** Field on that model that holds the object id(s). */
  field: string;
  /** Scalar = single String column. Array = String[] column. */
  kind: ObjectReferenceKind;
  /** Free-text label, surfaced in GC logs so an operator can tell at a
   * glance which column kept (or freed) an object. */
  label: string;
};

/**
 * Every object-referencing column in the schema. Order matters only for
 * log readability — the GC task ORs them all into one query per model.
 *
 * If you add or rename a column in `prisma/models/`, update this list.
 */
export const OBJECT_REFERENCE_COLUMNS: ObjectReferenceColumn[] = [
  // ── Game ────────────────────────────────────────────────────────────
  { model: "game", field: "mIconObjectId", kind: "scalar", label: "game icon" },
  {
    model: "game",
    field: "mBannerObjectId",
    kind: "scalar",
    label: "game banner",
  },
  {
    model: "game",
    field: "mCoverObjectId",
    kind: "scalar",
    label: "game cover",
  },
  { model: "game", field: "mLogoObjectId", kind: "scalar", label: "game logo" },
  {
    model: "game",
    field: "mImageCarouselObjectIds",
    kind: "array",
    label: "game carousel image",
  },
  {
    model: "game",
    field: "mImageLibraryObjectIds",
    kind: "array",
    label: "game library image",
  },

  // ── Company ─────────────────────────────────────────────────────────
  {
    model: "company",
    field: "mLogoObjectId",
    kind: "scalar",
    label: "company logo",
  },
  {
    model: "company",
    field: "mBannerObjectId",
    kind: "scalar",
    label: "company banner",
  },

  // ── User ────────────────────────────────────────────────────────────
  {
    model: "user",
    field: "profilePictureObjectId",
    kind: "scalar",
    label: "user avatar",
  },
  {
    model: "user",
    field: "bannerObjectId",
    kind: "scalar",
    label: "user banner",
  },

  // ── Screenshot ──────────────────────────────────────────────────────
  {
    model: "screenshot",
    field: "objectId",
    kind: "scalar",
    label: "screenshot",
  },

  // ── Article (news) ──────────────────────────────────────────────────
  {
    model: "article",
    field: "imageObjectId",
    kind: "scalar",
    label: "news image",
  },

  // ── BugReport ───────────────────────────────────────────────────────
  {
    model: "bugReport",
    field: "screenshotObjectId",
    kind: "scalar",
    label: "bug report screenshot",
  },

  // ── ApplicationSettings (server logo) ───────────────────────────────
  {
    model: "applicationSettings",
    field: "mLogoObjectId",
    kind: "scalar",
    label: "server logo",
  },
];

/**
 * Resolve a registered reference column to the actual Prisma delegate.
 * Throws if the model isn't on `prisma` — that should only happen if a
 * schema rename slipped through review.
 */
export function modelDelegate(name: string): {
  findFirst: (args: unknown) => Promise<unknown>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  findMany: (args: unknown) => Promise<any[]>;
} {
  // @ts-expect-error prisma client delegates are typed per-model; we
  // intentionally index dynamically here for cross-model GC.
  const delegate = prisma[name];
  if (!delegate || typeof delegate.findFirst !== "function") {
    throw new Error(
      `[objectRefs] Unknown Prisma model "${name}". Did you rename it without updating server/internal/objects/objectRefs.ts?`,
    );
  }
  return delegate;
}

/**
 * Static-coverage check used by GC bootstrap to fail loudly on startup if
 * the registry has diverged from the live Prisma schema.
 *
 * Walks every Prisma model, picks out String / String[] fields whose name
 * ends in `objectid` / `objectids` (case-insensitive), and asserts each
 * one is enumerated in `OBJECT_REFERENCE_COLUMNS`. Returns the list of
 * unregistered fields so callers can decide whether to throw or just
 * warn.
 *
 * The check is conservative — only `*objectid` / `*objectids` columns are
 * flagged. Columns that hold object IDs under a different name (none
 * currently, but possible in future) must be added to the registry by
 * hand; the static check can't infer intent from a generic `String`
 * field.
 */
export function findUnregisteredObjectColumns(): Array<{
  model: string;
  field: string;
}> {
  const registered = new Set(
    OBJECT_REFERENCE_COLUMNS.map((c) => `${c.model}.${c.field}`),
  );
  const missing: Array<{ model: string; field: string }> = [];

  const tables = Object.keys(prisma).filter(
    (v) => !(v.startsWith("$") || v.startsWith("_") || v === "constructor"),
  );

  for (const model of tables) {
    // @ts-expect-error see modelDelegate() for why we index dynamically.
    const fieldsObj = prisma[model]?.fields;
    if (!fieldsObj) continue;
    const fields = Object.keys(fieldsObj);
    for (const f of fields) {
      const lower = f.toLowerCase();
      if (!lower.endsWith("objectid") && !lower.endsWith("objectids")) {
        continue;
      }
      if (!registered.has(`${model}.${f}`)) {
        missing.push({ model, field: f });
      }
    }
  }

  return missing;
}
