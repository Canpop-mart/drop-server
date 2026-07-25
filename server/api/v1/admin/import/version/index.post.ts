import { ArkErrors, type } from "arktype";
import { Platform } from "~/prisma/client/enums";
import { readDropValidatedBody, throwingArktype } from "~/server/arktype";
import aclManager from "~/server/internal/acls";
import libraryManager from "~/server/internal/library";

export const ImportVersion = type({
  id: "string",
  version: type({
    type: "'depot' | 'local'",
    identifier: "string",
    name: "string",
  }),
  displayName: "string?",

  launches: type({
    platform: type.valueOf(Platform),
    name: "string",
    launch: "string",
    umuId: "string?",
    emulatorId: "string?",
    suggestions: "string[]?",
    discPaths: "string[]?",
  }).array(),

  setups: type({
    platform: type.valueOf(Platform),
    launch: "string",
  }).array(),

  onlySetup: "boolean = false",
  delta: "boolean = false",

  // Mod placement (type=Mod games): where this version overlays + optional
  // launch override. Both relative to the base game's install dir.
  ["modInstallDir?"]: "string",
  ["launchOverride?"]: "string | null",

  requiredContent: type("string")
    .array()
    .default(() => []),
}).configure(throwingArktype);

/** Query params — `?dryRun=true` previews the import without writing. */
const ImportVersionQuery = type({
  dryRun: "string?",
});

export default defineEventHandler(async (h3) => {
  const allowed = await aclManager.allowSystemACL(h3, ["import:version:new"]);
  if (!allowed) throw createError({ statusCode: 403 });

  const query = ImportVersionQuery(getQuery(h3));
  if (query instanceof ArkErrors)
    throw createError({ statusCode: 400, message: query.summary });
  const dryRun = query.dryRun === "true" || query.dryRun === "1";

  const body = await readDropValidatedBody(h3, ImportVersion);

  // ── Dry-run: synchronous, returns a receipt-shaped JSON, no task ─────
  if (dryRun) {
    const receipt = await libraryManager.dryRunVersionImport(
      body.id,
      body.version,
      body,
    );
    if (!receipt)
      throw createError({
        statusCode: 400,
        statusMessage: "Invalid options for import",
      });
    return { dryRun: true, receipt };
  }

  const taskId = await libraryManager.importVersion(
    body.id,
    body.version,
    body,
  );
  if (!taskId)
    throw createError({
      statusCode: 400,
      statusMessage: "Invalid options for import",
    });

  return { taskId };
});
