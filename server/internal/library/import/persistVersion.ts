/**
 * Import phase 5 — persist the version.
 *
 * Writes the GameVersion row, clears the game's update-available flag,
 * drops the consumed UnimportedGameVersion (depot), warms the size
 * cache, fires the completion notification, and writes the structured
 * `ImportReceipt`.
 *
 * The GameVersion insert + size-cache warm are wrapped so a failing
 * cache step never leaves a half-imported version behind: if anything
 * after the insert throws hard, the GameVersion row is rolled back. The
 * size-cache warm itself is best-effort (its failure is downgraded to a
 * warning) — only genuinely unexpected errors trigger the rollback.
 *
 * Phase label: [PHASE:persist]
 */

import prisma from "../../db/database";
import notificationSystem from "../../notifications";
import gameSizeManager from "../../gamesize";
import { GameType } from "~/prisma/client/enums";
import { readGoldbergAppId } from "../../goldberg";
import type {
  ImportContext,
  ManifestResult,
  ManifestValidationResult,
  EmulatorSetupResult,
  PreparedDirectory,
  PersistResult,
} from "./types";

const PHASE = "[PHASE:persist]";

export async function persistVersion(
  ctx: ImportContext,
  prepared: PreparedDirectory,
  manifestResult: ManifestResult,
  validation: ManifestValidationResult,
  emulators: EmulatorSetupResult,
  phaseTimings: PersistArgsPhaseTimings,
): Promise<PersistResult> {
  const { gameId, metadata, version, logger } = ctx;

  // ── Multi-disc: repoint libraryPath so torrential can find files ─────
  if (prepared.newLibraryPath) {
    await prisma.game.updateMany({
      where: { id: gameId },
      data: { libraryPath: prepared.newLibraryPath },
    });
    logger.info(
      `${PHASE} Updated libraryPath to ${prepared.newLibraryPath} for multi-disc serving`,
    );
  }

  const largestIndex = await prisma.gameVersion.findFirst({
    where: { gameId },
    orderBy: { versionIndex: "desc" },
    select: { versionIndex: true },
  });
  const currentIndex = largestIndex ? largestIndex.versionIndex + 1 : 0;

  // Default the umu GAMEID to the game's Steam AppID so umu-launcher applies
  // its per-game protonfixes (runtime deps, dll overrides) on Linux/Deck.
  // Prefer the AppID from metadata, fall back to steam_appid.txt for cracked
  // games. An explicit per-launch umuId from the importer always wins.
  const autoUmuId =
    ctx.steamAppId ??
    (prepared.versionDir ? readGoldbergAppId(prepared.versionDir) : undefined);
  if (autoUmuId)
    logger.info(
      `${PHASE} umu GAMEID defaults to Steam AppID ${autoUmuId} (protonfixes)`,
    );

  // ── 1. Insert the GameVersion row ────────────────────────────────────
  const newVersion = await prisma.gameVersion.create({
    data: {
      game: { connect: { id: gameId } },
      displayName: metadata.displayName ?? prepared.versionPath ?? null,
      versionPath: prepared.versionPath,
      dropletManifest: JSON.stringify(manifestResult.manifest),
      fileList: manifestResult.fileList,
      versionIndex: currentIndex,
      delta: metadata.delta,
      onlySetup: metadata.onlySetup,
      setups: {
        createMany: {
          data: metadata.setups.map((v) => ({
            command: v.launch,
            platform: v.platform,
          })),
        },
      },
      launches: {
        createMany: !metadata.onlySetup
          ? {
              data: metadata.launches.map((v) => ({
                name: v.name,
                command: v.launch,
                platform: v.platform,
                ...(v.emulatorId && ctx.gameType === GameType.Game
                  ? { emulatorId: v.emulatorId }
                  : undefined),
                emulatorSuggestions:
                  ctx.gameType === GameType.Emulator
                    ? (v.suggestions ?? [])
                    : [],
                discPaths: v.discPaths ?? [],
                // Explicit importer umuId wins; otherwise default to the
                // Steam AppID so umu pulls the game's protonfixes. Store is
                // "steam" only when we auto-fill from a real Steam AppID.
                umuIdOverride: v.umuId ?? autoUmuId ?? null,
                umuStoreOverride: !v.umuId && autoUmuId ? "steam" : null,
              })),
            }
          : { data: [] },
      },
    },
  });
  logger.info(`${PHASE} Created GameVersion ${newVersion.versionId}`);

  // Everything past the insert is wrapped: if it throws we delete the
  // freshly-created row so a failed post-step can't leak a partial
  // version. The size-cache warm is itself best-effort and won't trip
  // this — only truly unexpected failures (notification/receipt) do.
  try {
    // ── 2. Clear the update-available flag ─────────────────────────────
    await prisma.game.updateMany({
      where: { id: gameId },
      data: { updateAvailable: false },
    });

    // ── 3. Drop the consumed depot UnimportedGameVersion ───────────────
    if (version.type === "depot") {
      // eslint-disable-next-line drop/no-prisma-delete
      await prisma.unimportedGameVersion.delete({
        where: { id: version.identifier },
      });
      logger.info(`${PHASE} Removed consumed depot version row`);
    }

    // ── 4. Warm the size cache (best-effort) ───────────────────────────
    try {
      await gameSizeManager.getVersionSize(newVersion.versionId);
      logger.info(`${PHASE} Size cache warmed`);
    } catch (e) {
      logger.warn(`${PHASE} Size-cache warm failed (non-critical): ${e}`);
      ctx.warnings.push(`Size cache warm failed: ${e}`);
    }

    // ── 5. Write the structured ImportReceipt ──────────────────────────
    await prisma.importReceipt.create({
      data: {
        gameVersion: { connect: { versionId: newVersion.versionId } },
        phaseTimingsJson: phaseTimings,
        fileCount: validation.fileCount,
        totalSizeBytes: BigInt(validation.totalSizeBytes),
        chunkCount: validation.chunkCount,
        dllSwapApplied: emulators.dllSwapApplied,
        dllSwapName: emulators.dllSwapName ?? null,
        warnings: ctx.warnings,
      },
    });
    logger.info(
      `${PHASE} Wrote ImportReceipt (${validation.fileCount} files, ` +
        `${validation.chunkCount} chunks, dllSwap=${emulators.dllSwapApplied})`,
    );

    // ── 6. Completion notification ─────────────────────────────────────
    notificationSystem.systemPush({
      nonce: `version-create-${gameId}-${version.identifier}`,
      title: `'${ctx.gameName}' ('${version.name}') finished importing.`,
      description: `Drop finished importing version ${version.name} for ${ctx.gameName}.`,
      actions: [`View|/admin/library/${gameId}`],
      acls: ["system:import:version:read"],
    });
  } catch (e) {
    // Roll back the GameVersion so a failed post-step doesn't leak a
    // partial import. Receipt rows cascade-delete with the version.
    logger.warn(
      `${PHASE} Post-insert step failed (${e}) — rolling back GameVersion ${newVersion.versionId}`,
    );
    try {
      await prisma.gameVersion.deleteMany({
        where: { versionId: newVersion.versionId },
      });
    } catch (rollbackErr) {
      logger.warn(
        `${PHASE} Rollback of GameVersion ${newVersion.versionId} failed: ${rollbackErr}`,
      );
    }
    throw e;
  }

  return { versionId: newVersion.versionId };
}

/** Phase timings array, as written into the ImportReceipt JSON. */
export type PersistArgsPhaseTimings = Array<{
  name: string;
  startedAt: string;
  endedAt: string;
  durationMs: number;
}>;
