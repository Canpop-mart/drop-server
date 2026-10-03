/**
 * Resolves a game version to the folder its revisions are computed from, and
 * refuses the versions in-place updates can't handle, with a reason an admin
 * can act on.
 */

import fs from "node:fs";
import prisma from "../../db/database";
import { libraryManager } from "..";
import type { LibraryProvider } from "../provider";

export type RevisionTargetRefusal =
  | "not-found"
  | "depot"
  | "multi-disc"
  | "delta"
  | "under-delta"
  | "library-missing"
  | "folder-missing"
  | "folder-unreadable"
  | "archive";

export class RevisionTargetError extends Error {
  constructor(
    readonly kind: RevisionTargetRefusal,
    message: string,
    readonly statusCode: number = 400,
  ) {
    super(message);
    this.name = "RevisionTargetError";
  }
}

export type RevisionTarget = {
  gameId: string;
  gameName: string;
  versionId: string;
  /** Display name, falling back to the folder name. */
  versionName: string;
  revision: number;
  libraryPath: string;
  versionPath: string;
  /** Absolute folder on disk. Always a directory. */
  versionDir: string;
  library: LibraryProvider<unknown>;
  /** Library-level "set up emulators on import" policy (default on). */
  autoEmulatorSetup: boolean;
};

/**
 * Throws RevisionTargetError (404 when the version doesn't exist, 400 for a
 * version that can't be updated in place).
 *
 * @param gameId when given, the version must belong to this game.
 * @param forPublish also refuse versions that can be hashed but not
 *   published in place: delta (update-mode) versions, and a version that
 *   delta versions are layered on top of.
 */
export async function resolveRevisionTarget(
  versionId: string,
  gameId?: string,
  forPublish = false,
): Promise<RevisionTarget> {
  const version = await prisma.gameVersion.findUnique({
    where: { versionId },
    select: {
      versionId: true,
      gameId: true,
      displayName: true,
      versionPath: true,
      revision: true,
      delta: true,
      versionIndex: true,
      game: {
        select: {
          mName: true,
          libraryId: true,
          libraryPath: true,
          discFolders: true,
          library: { select: { autoEmulatorSetup: true } },
        },
      },
    },
  });
  if (!version || (gameId && version.gameId !== gameId)) {
    throw new RevisionTargetError("not-found", "Version not found.", 404);
  }

  if (!version.versionPath) {
    throw new RevisionTargetError(
      "depot",
      "This version has no folder on the server (it was imported from a depot), so it can't be updated in place.",
    );
  }
  if (version.game.discFolders && version.game.discFolders.length > 1) {
    throw new RevisionTargetError(
      "multi-disc",
      "Multi-disc games can't be updated in place yet. Import the changed files as a new version instead.",
    );
  }

  if (forPublish && version.delta) {
    throw new RevisionTargetError(
      "delta",
      "This is an update-mode (delta) version layered on an older one. Delta versions can't be updated in place; import the changes as a new version instead.",
    );
  }
  if (forPublish) {
    // A delta version layers onto every version below it down to the first
    // non-delta one, so this version is under a delta exactly when the next
    // version above it is a delta.
    const above = await prisma.gameVersion.findFirst({
      where: {
        gameId: version.gameId,
        versionIndex: { gt: version.versionIndex },
      },
      orderBy: { versionIndex: "asc" },
      select: { delta: true, displayName: true, versionPath: true },
    });
    if (above?.delta) {
      throw new RevisionTargetError(
        "under-delta",
        `Update-mode (delta) version "${above.displayName || above.versionPath || "?"}" is layered on top of this version, so it can't be updated in place.`,
      );
    }
  }

  const library = libraryManager.getLibrary(version.game.libraryId);
  if (!library) {
    throw new RevisionTargetError(
      "library-missing",
      "The library this game is in is not loaded. Check it under Library sources, or restart the server.",
    );
  }

  const versionDir = library.resolveVersionDir(
    version.game.libraryPath,
    version.versionPath,
  );
  if (!versionDir) {
    throw new RevisionTargetError(
      "folder-missing",
      `The version folder was not found on the server: ${version.game.libraryPath}/${version.versionPath}`,
    );
  }
  let isDir = false;
  try {
    isDir = fs.statSync(versionDir).isDirectory();
  } catch (e) {
    throw new RevisionTargetError(
      "folder-unreadable",
      `The version folder can't be read: ${versionDir} (${e})`,
    );
  }
  if (!isDir) {
    throw new RevisionTargetError(
      "archive",
      "This version is an archive file, not a folder. In-place updates only work on folders.",
    );
  }

  return {
    gameId: version.gameId,
    gameName: version.game.mName,
    versionId: version.versionId,
    versionName: version.displayName || version.versionPath,
    revision: version.revision,
    libraryPath: version.game.libraryPath,
    versionPath: version.versionPath,
    versionDir,
    library,
    autoEmulatorSetup: version.game.library?.autoEmulatorSetup ?? true,
  };
}
