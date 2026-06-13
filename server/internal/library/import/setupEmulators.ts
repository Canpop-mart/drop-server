/**
 * Import phase 2 — emulator setup (achievements + steam_settings only).
 *
 * Drop no longer swaps a game's steam_api DLL. Games ship with whatever
 * Steam emulator they need (GBE for offline, OnlineFix for online); one
 * uploaded without is the uploader's responsibility. This phase now only:
 *   1. Detects the emulator (for logging / the import receipt).
 *   2. Runs `setupGoldberg` for achievement DB sync + steam_settings/
 *      scaffolding — no DLL swap.
 *   3. Auto-tags "Multiplayer" when a loader crack (OnlineFix etc.) is
 *      present, since those ship a working online mode.
 *
 * The whole phase is a FULL no-op when `ctx.autoEmulatorSetup` is false
 * (library-level skip), for depot imports, or in dry-run mode.
 *
 * Phase label: [PHASE:emulator]
 */

import { detectCrackLoader, detectEmulator } from "../../gbe";
import { setupGoldberg } from "../../goldberg";
import prisma from "~/server/internal/db/database";
import type { ImportContext, EmulatorSetupResult } from "./types";

const PHASE = "[PHASE:emulator]";

export async function setupEmulators(
  ctx: ImportContext,
  versionDir: string | undefined,
): Promise<EmulatorSetupResult> {
  const { logger } = ctx;

  // ── Library-level full skip ──────────────────────────────────────────
  if (!ctx.autoEmulatorSetup) {
    logger.info(
      `${PHASE} autoEmulatorSetup is OFF for this library — skipping ` +
        `Goldberg achievement setup entirely.`,
    );
    return { dllSwapApplied: false, skipped: true };
  }

  // ── Depot imports have no local files to set up ──────────────────────
  if (!versionDir) {
    logger.info(
      `${PHASE} No local version directory (depot import) — emulator setup skipped`,
    );
    return { dllSwapApplied: false, skipped: true };
  }

  // ── Dry-run — report intent, mutate nothing ──────────────────────────
  if (ctx.dryRun) {
    const detection = detectEmulator(versionDir);
    if (!detection) {
      logger.info(`${PHASE} Dry-run — no steam_api DLL found, nothing to do`);
    } else {
      logger.info(
        `${PHASE} Dry-run — detected emulator type "${detection.type}" ` +
          `(${detection.dllName}); a real import would run Goldberg setup`,
      );
    }
    return { dllSwapApplied: false, skipped: false };
  }

  try {
    // ── 1. Detect the emulator (logging / receipt only) ────────────────
    const detection = detectEmulator(versionDir);
    if (!detection) {
      logger.info(`${PHASE} No steam_api DLL under ${versionDir}`);
    } else {
      logger.info(
        `${PHASE} Emulator detection: type="${detection.type}", ` +
          `dll=${detection.dllName} @ ${detection.dllDir}`,
      );
    }

    // ── 2. Goldberg setup — achievements + steam_settings/ scaffolding ──
    // No DLL swap: setupGoldberg only writes achievement definitions +
    // steam_settings for games that already ship a GBE/Goldberg build.
    await setupGoldberg(ctx.gameId, versionDir, { logger });

    // ── 3. Auto-tag multiplayer ────────────────────────────────────────
    // A loader crack (OnlineFix etc.) means the game has a multiplayer mode
    // — OnlineFix spoofs the SpaceWar lobby. Steam metadata often misses
    // these, so tag from the files. connectOrCreate by the unique tag name
    // reuses the same "Multiplayer" tag the metadata path creates.
    const loaderMarker = detectCrackLoader(versionDir);
    if (loaderMarker) {
      // SAFETY: ctx.gameId is the in-flight import target; a relation
      // connectOrCreate can only be expressed via update(), not updateMany().
      // eslint-disable-next-line drop/no-prisma-delete
      await prisma.game.update({
        where: { id: ctx.gameId },
        data: {
          tags: {
            connectOrCreate: {
              where: { name: "Multiplayer" },
              create: { name: "Multiplayer" },
            },
          },
        },
      });
      logger.info(
        `${PHASE} OnlineFix/loader crack (${loaderMarker}) detected → tagged "Multiplayer"`,
      );
    }
  } catch (e) {
    // Emulator setup must never block an import — record + carry on.
    logger.warn(`${PHASE} Emulator setup failed (non-critical): ${e}`);
    ctx.warnings.push(`Emulator setup error: ${e}`);
  }

  return { dllSwapApplied: false, skipped: false };
}
