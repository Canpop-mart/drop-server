/**
 * Import phase 2 — emulator setup (DLL swap + achievements + steam_settings).
 *
 * Plan B "GBE everywhere": every eligible game's steam_api DLL is replaced
 * with the bundled gbe_fork build at import, so the game gets achievements +
 * Goldberg LAN/ZeroTier matchmaking with zero per-game setup. This phase:
 *   1. Detects the emulator (for logging / the import receipt).
 *   2. Runs `setupGoldberg(swapDll=true)` — swaps eligible steam_api DLLs to
 *      GBE, writes steam_settings/ (appid + networking + save path), then
 *      syncs achievement definitions to the DB. The swap runs BEFORE the
 *      manifest phase so the GBE bytes are what the client downloads.
 *   3. Auto-tags "Multiplayer" when a loader crack (OnlineFix etc.) is
 *      present, since those ship a working online mode.
 *
 * Eligibility (decided per-DLL in gbe.ts): vanilla Valve + unknown builds are
 * swapped; already-GBE is skipped; anti-cheat (EAC/BattlEye) and loader cracks
 * (OnlineFix/Cream) are left untouched — the latter until the dedicated
 * OnlineFix-removal step also strips the loader siblings.
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
  let dllSwapApplied = false;
  let dllSwapName: string | undefined;

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

    // Capture loader-crack presence BEFORE the swap. setupGoldberg's swap
    // strips OnlineFix/Cream loader files, so detecting after would miss them
    // and the game would lose its "Multiplayer" tag.
    const loaderMarker = detectCrackLoader(versionDir);

    // ── 2. Goldberg setup — DLL swap + achievements + steam_settings/ ───
    // swapDll=true: replace eligible steam_api DLLs with bundled GBE, write
    // steam_settings, then sync achievement definitions.
    const goldberg = await setupGoldberg(ctx.gameId, versionDir, {
      logger,
      swapDll: true,
    });
    if (goldberg.dllsSwapped > 0) {
      dllSwapApplied = true;
      dllSwapName =
        goldberg.dllsSwapped === 1
          ? detection?.dllName
          : `${goldberg.dllsSwapped} DLLs`;
      logger.info(
        `${PHASE} Swapped ${goldberg.dllsSwapped} steam_api DLL(s) to bundled GBE`,
      );
    }

    // ── 3. Auto-tag multiplayer ────────────────────────────────────────
    // A loader crack (OnlineFix etc.) means the game has a multiplayer mode
    // — OnlineFix spoofs the SpaceWar lobby. Steam metadata often misses
    // these, so tag from the files (captured pre-swap above). connectOrCreate
    // by the unique tag name reuses the same "Multiplayer" tag the metadata
    // path creates.
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

  return { dllSwapApplied, dllSwapName, skipped: false };
}
