import { type } from "arktype";
import {
  readDropValidatedBody,
  throwingArktype,
  requireRouterParam,
} from "~/server/arktype";
import aclManager from "~/server/internal/acls";
import prisma from "~/server/internal/db/database";
import {
  saveMirrorFolders,
  sameMirrorFolders,
  type MirrorFoldersSaved,
} from "~/server/internal/library/revisions/publish";
import { RevisionTargetError } from "~/server/internal/library/revisions/target";
import {
  describeMirrorFolderError,
  foldersFromFileList,
  normalizeMirrorFolders,
} from "~/server/internal/library/revisions/mirror";

const UpdateVersionMetadata = type({
  displayName: "string?",
  onlySetup: "boolean?",
  delta: "boolean?",
  // Replaces the whole list when sent ([] clears it). Normalized below. A
  // change also publishes a new revision with the same files, when the
  // version can be published (see saveMirrorFolders).
  mirrorFolders: "string[]?",
}).configure(throwingArktype);

export default defineEventHandler(async (h3) => {
  const allowed = await aclManager.allowSystemACL(h3, ["game:version:update"]);
  if (!allowed) throw createError({ statusCode: 403 });

  const gameId = requireRouterParam(h3, "id");
  const versionId = requireRouterParam(h3, "versionId");
  const body = await readDropValidatedBody(h3, UpdateVersionMetadata);

  // Verify version belongs to this game
  const version = await prisma.gameVersion.findFirst({
    where: { versionId, gameId },
  });
  if (!version)
    throw createError({ statusCode: 404, statusMessage: "Version not found" });

  let mirrorFolders: string[] | undefined;
  if (body.mirrorFolders !== undefined) {
    // The version's own folders fix the case of entries typed differently.
    const normalized = normalizeMirrorFolders(
      body.mirrorFolders,
      foldersFromFileList(version.fileList),
    );
    if (!normalized.ok)
      throw createError({
        statusCode: 400,
        statusMessage: describeMirrorFolderError(normalized.error),
      });
    mirrorFolders = normalized.folders;
  }

  const data: Record<string, unknown> = {};
  if (body.displayName !== undefined)
    data.displayName = body.displayName || null;
  if (body.onlySetup !== undefined) data.onlySetup = body.onlySetup;
  if (body.delta !== undefined) data.delta = body.delta;

  const writeOtherFields = async () => {
    const result = await prisma.gameVersion.updateMany({
      where: { versionId, gameId },
      data,
    });
    if (result.count === 0)
      throw createError({
        statusCode: 404,
        statusMessage: "Version not found",
      });
  };

  // Same folders as stored (order aside): nothing to publish, so no lock.
  // A save that doesn't change the list (renaming, say) never waits on it.
  if (
    mirrorFolders === undefined ||
    sameMirrorFolders(version.mirrorFolders, mirrorFolders)
  ) {
    await writeOtherFields();
    const unchanged: MirrorFoldersSaved | undefined =
      mirrorFolders === undefined
        ? undefined
        : {
            mirrorFolders: version.mirrorFolders,
            revisionPublished: false,
            reason: "unchanged",
          };
    return { versionId, ...data, ...unchanged };
  }

  // A changed list: everything is written under the version lock, which is
  // taken without waiting, so a running check or publish gets a 409 here
  // instead of holding this request for as long as it takes.
  let saved: Awaited<ReturnType<typeof saveMirrorFolders>>;
  try {
    saved = await saveMirrorFolders(
      gameId,
      versionId,
      mirrorFolders,
      writeOtherFields,
    );
  } catch (e) {
    if (e instanceof RevisionTargetError)
      throw createError({ statusCode: e.statusCode, statusMessage: e.message });
    throw e;
  }
  if ("busy" in saved)
    throw createError({
      statusCode: 409,
      statusMessage:
        "This version is busy (a check, publish, fingerprint run, manifest regeneration or another save is running). Nothing was saved; save again once it finishes.",
    });

  return { versionId, ...data, ...saved };
});
