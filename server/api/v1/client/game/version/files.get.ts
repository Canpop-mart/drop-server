import { ArkErrors, type } from "arktype";
import { defineClientEventHandler } from "~/server/internal/clients/event-handler";
import prisma from "~/server/internal/db/database";
import { readSnapshot } from "~/server/internal/library/revisions/store";

const Query = type({
  version: "string",
  revision: "string?",
});

/**
 * GET /api/v1/client/game/version/files?version=<versionId>&revision=<n>
 *
 * The per-file hashes of one revision of a version, the baseline and target
 * of a client's in-place update:
 *   { versionId, revision, files: [{ path, size, sha256 }] }
 *
 * - `revision` omitted: the version's current revision.
 * - `revision=earliest`: the lowest revision stored for the version.
 * - 404 "Revision not found." when there is no snapshot for it (nobody has
 *   recorded fingerprints for the version yet, or it never existed).
 *
 * Snapshots outlive deleted versions, so a numbered or earliest revision of a
 * deleted version is still served. `sha256` is "" for a file whose original
 * content could not be established (see revisions/diff.ts UNKNOWN_SHA256);
 * it never matches a real hash.
 */
export default defineClientEventHandler(async (h3) => {
  const query = Query(getQuery(h3));
  if (query instanceof ArkErrors)
    throw createError({ statusCode: 400, statusMessage: query.summary });

  let which: number | "earliest";
  if (query.revision === undefined) {
    const version = await prisma.gameVersion.findUnique({
      where: { versionId: query.version },
      select: { revision: true },
    });
    if (!version)
      throw createError({
        statusCode: 404,
        statusMessage: "Revision not found.",
      });
    which = version.revision;
  } else if (query.revision === "earliest") {
    which = "earliest";
  } else if (/^[0-9]{1,9}$/.test(query.revision)) {
    which = Number(query.revision);
  } else {
    throw createError({
      statusCode: 400,
      statusMessage: 'revision must be a number or "earliest"',
    });
  }

  const snapshot = await readSnapshot(query.version, which);
  if (!snapshot)
    throw createError({
      statusCode: 404,
      statusMessage: "Revision not found.",
    });

  return {
    versionId: snapshot.versionId,
    revision: snapshot.revision,
    files: snapshot.files,
  };
});
