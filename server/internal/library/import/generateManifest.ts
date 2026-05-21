/**
 * Import phase 3 — manifest generation.
 *
 * Invokes droplet to produce the version manifest and its file list.
 * Runs AFTER `setupEmulators`, so for SSE / Steam-DRM games the manifest
 * checksums are computed over the post-swap bytes — there is no second
 * manifest pass and `regenerateManifestForLatestVersion` is NOT called.
 *
 * For depot imports the manifest already exists on the
 * `UnimportedGameVersion` row; this phase just casts and returns it.
 *
 * Phase label: [PHASE:manifest]
 */

import { castManifest } from "../manifest/utils";
import { dropletInterface } from "../../services/torrential/droplet-interface";
import prisma from "../../db/database";
import type { ImportContext, ManifestResult, PreparedDirectory } from "./types";

const PHASE = "[PHASE:manifest]";

export async function generateManifest(
  ctx: ImportContext,
  prepared: PreparedDirectory,
): Promise<ManifestResult> {
  const { version, library, logger, task } = ctx;

  // ── Depot imports — manifest is already stored ───────────────────────
  if (version.type === "depot") {
    const unimported = await prisma.unimportedGameVersion.findUnique({
      where: { id: version.identifier },
    });
    if (!unimported) {
      throw new Error(
        `${PHASE} Depot version ${version.identifier} no longer exists`,
      );
    }
    logger.info(`${PHASE} Using stored depot manifest for "${version.name}"`);
    task.progress(90);
    return {
      manifest: castManifest(unimported.manifest),
      fileList: unimported.fileList,
    };
  }

  if (!prepared.versionPath) {
    throw new Error(`${PHASE} Missing versionPath for local import`);
  }

  // ── Dry-run — plan only, don't invoke droplet ────────────────────────
  if (ctx.dryRun) {
    logger.info(
      `${PHASE} Dry-run — skipping droplet manifest generation; ` +
        `a real import would generate a manifest from ${prepared.versionDir}`,
    );
    // Return an empty manifest shell — validateManifest treats dry-run
    // specially and won't reject on this.
    return {
      manifest: { version: "2", size: 0, key: [], chunks: {} },
      fileList: [],
    };
  }

  // Manifest generation is the bulk of the work — scale it to 0–90%.
  const reportProgress = (value: number) => task.progress(value * 0.9);

  if (ctx.isMultiDisc) {
    if (!prepared.versionDir) {
      throw new Error(`${PHASE} Multi-disc import missing staging directory`);
    }
    logger.info(
      `${PHASE} Generating manifest from multi-disc staging dir ${prepared.versionDir}`,
    );
    const manifest = await dropletInterface.generateDropletManifest(
      prepared.versionDir,
      reportProgress,
      (value) => logger.info(`${PHASE} ${value}`),
    );
    const fileList = await dropletInterface.listFiles(prepared.versionDir);
    logger.info(
      `${PHASE} Manifest generated (${fileList.length} files across ${ctx.discFolders.length} disc(s))`,
    );
    return { manifest: castManifest(manifest), fileList };
  }

  const effectiveLibraryPath = ctx.libraryPath;
  logger.info(
    `${PHASE} Generating manifest for ${effectiveLibraryPath}/${prepared.versionPath}`,
  );
  const manifest = await library.generateDropletManifest(
    effectiveLibraryPath,
    prepared.versionPath,
    reportProgress,
    (value) => logger.info(`${PHASE} ${value}`),
  );
  const fileList = await library.versionReaddir(
    effectiveLibraryPath,
    prepared.versionPath,
  );
  logger.info(`${PHASE} Manifest generated (${fileList.length} files)`);
  return { manifest: castManifest(manifest), fileList };
}
