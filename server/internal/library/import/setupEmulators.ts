/**
 * Import phase 2 — emulator setup (single pass).
 *
 * Runs BEFORE manifest generation so the manifest is computed over the
 * post-swap bytes — no second manifest pass, no checksum mismatch on
 * client downloads.
 *
 * This phase:
 *   1. Detects the emulator once (`detectEmulator`) and threads the
 *      `EmulatorDetection` through both the SSE-upgrade decision and
 *      `setupGoldberg` — the old code called `detectEmulator` twice.
 *   2. If SSE (cracked) → swaps the SSE DLL for GBE up-front.
 *   3. Else if legitimate Steam DRM markers + a Steam AppID → swaps via
 *      the gated `ensureGbeDll` path.
 *   4. Runs `setupGoldberg` for achievement DB sync + steam_settings/
 *      scaffolding. `setupGoldberg` independently honours the per-game /
 *      per-library `autoSwapSteamApiDll` flag for its own DLL step.
 *
 * The whole phase is a FULL no-op when `ctx.autoEmulatorSetup` is false
 * (library-level skip), for depot imports, or in dry-run mode.
 *
 * Phase label: [PHASE:emulator]
 */

import fs from "fs";
import path from "path";
import {
  detectCrackLoader,
  detectEmulator,
  ensureGbeDll,
  findSteamApiDll,
  hasSteamDrmMarker,
  identifySteamApiDll,
  type EmulatorDetection,
} from "../../gbe";
import { setupGoldberg } from "../../goldberg";
import prisma from "~/server/internal/db/database";
import type { ImportContext, EmulatorSetupResult } from "./types";

const PHASE = "[PHASE:emulator]";

/**
 * Swaps an SSE steam_api DLL for the cached GBE build and writes the
 * `steam_settings/` config from the parsed SSE ini. Re-implemented here
 * only as a thin call into the gbe.ts swap primitive via dynamic import
 * of the internal helper is NOT possible (it's not exported), so we use
 * the exported `ensureGbeDll` with a forced swap — SSE DLLs are a known
 * crack so the gated path would otherwise skip them.
 *
 * Returns true when the swap landed.
 */
async function swapSseDll(
  detection: EmulatorDetection,
  ctx: ImportContext,
): Promise<boolean> {
  const { sseConfig } = detection;
  if (!sseConfig) return false;

  // ensureGbeDll with forceGbeSwap handles caching/downloading the GBE
  // DLL, backing up the original, and writing steam_settings/. We pass
  // forceGbeSwap because an SSE DLL fingerprints as a known crack.
  const result = await ensureGbeDll(
    detection.dllDir,
    detection.dllName,
    sseConfig.appId,
    ctx.logger,
    { forceGbeSwap: true },
  );

  if (result.swapped) {
    ctx.logger.info(
      `${PHASE} SSE → GBE swap applied for ${detection.dllName} ` +
        `(AppID ${sseConfig.appId})`,
    );
    // Persist SSE [Interfaces] / [DLC] blocks alongside the new DLL so
    // GBE can resolve them. ensureGbeDll only writes steam_appid.txt +
    // configs.user.ini, so we top up the extras here.
    try {
      const steamSettings = path.join(detection.dllDir, "steam_settings");
      fs.mkdirSync(steamSettings, { recursive: true });
      if (sseConfig.interfaces.size > 0) {
        fs.writeFileSync(
          path.join(steamSettings, "steam_interfaces.txt"),
          Array.from(sseConfig.interfaces.values()).join("\n") + "\n",
          "utf-8",
        );
      }
      if (sseConfig.dlcs.size > 0) {
        fs.writeFileSync(
          path.join(steamSettings, "dlc.txt"),
          Array.from(sseConfig.dlcs.entries())
            .map(([id, name]) => `${id}=${name}`)
            .join("\n") + "\n",
          "utf-8",
        );
      }
    } catch (e) {
      ctx.warnings.push(`Failed to write SSE interface/DLC files: ${e}`);
      ctx.logger.warn(`${PHASE} Could not write SSE extras: ${e}`);
    }
    return true;
  }

  if (result.alreadyGbe) {
    ctx.logger.info(
      `${PHASE} ${detection.dllName} is already a GBE build, no SSE swap needed`,
    );
  } else {
    ctx.warnings.push(
      `SSE DLL swap did not apply: ${result.error ?? result.identification?.fingerprint ?? "unknown"}`,
    );
    ctx.logger.warn(
      `${PHASE} SSE swap not applied: ${result.error ?? "see fingerprint"}`,
    );
  }
  return false;
}

export async function setupEmulators(
  ctx: ImportContext,
  versionDir: string | undefined,
): Promise<EmulatorSetupResult> {
  const { logger } = ctx;

  // ── Library-level full skip ──────────────────────────────────────────
  if (!ctx.autoEmulatorSetup) {
    logger.info(
      `${PHASE} autoEmulatorSetup is OFF for this library — skipping ` +
        `SSE detection, Goldberg achievement setup and the DLL swap entirely.`,
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
          `(${detection.dllName}); a real import would run Goldberg setup` +
          (detection.type === "sse" ? " and an SSE → GBE swap" : ""),
      );
    }
    return { dllSwapApplied: false, skipped: false };
  }

  let dllSwapApplied = false;
  let dllSwapName: string | undefined;

  try {
    // ── 1. Detect the emulator ONCE ────────────────────────────────────
    const detection = detectEmulator(versionDir);

    if (!detection) {
      logger.info(
        `${PHASE} No steam_api DLL under ${versionDir} — nothing to swap`,
      );
    } else {
      logger.info(
        `${PHASE} Emulator detection: type="${detection.type}", ` +
          `dll=${detection.dllName} @ ${detection.dllDir}`,
      );

      // ── 2. SSE (cracked) → GBE, up front, gated on autoSwapDll ───────
      if (detection.type === "sse" && detection.sseConfig) {
        if (!ctx.autoSwapDll) {
          logger.warn(
            `${PHASE} SSE detected but autoSwapSteamApiDll is OFF — ` +
              `leaving ${detection.dllName} untouched`,
          );
          ctx.warnings.push(
            "SSE detected but DLL swap disabled by autoSwapSteamApiDll",
          );
        } else {
          const swapped = await swapSseDll(detection, ctx);
          if (swapped) {
            dllSwapApplied = true;
            dllSwapName = detection.dllName;
          }
        }
      } else if (detection.type !== "sse" && ctx.autoSwapDll) {
        // ── 3. Legit Steam DRM → GBE (only if not already configured) ──
        const hasSettings = fs.existsSync(
          path.join(detection.dllDir, "steam_settings"),
        );
        if (!hasSettings && ctx.steamAppId && hasSteamDrmMarker(versionDir)) {
          logger.info(
            `${PHASE} Steam DRM markers present (AppID ${ctx.steamAppId}); ` +
              `checking ${detection.dllName} fingerprint before swap`,
          );
          const result = await ensureGbeDll(
            detection.dllDir,
            detection.dllName,
            ctx.steamAppId,
            logger,
          );
          if (result.swapped) {
            dllSwapApplied = true;
            dllSwapName = detection.dllName;
            logger.info(
              `${PHASE} Steam DRM → GBE swap applied for ${detection.dllName}`,
            );
          } else if (result.skipped) {
            ctx.warnings.push(
              `GBE swap skipped to preserve existing DLL: ` +
                `${result.identification?.fingerprint ?? "unknown"}`,
            );
            logger.warn(
              `${PHASE} Swap skipped (${result.identification?.fingerprint ?? "n/a"})`,
            );
          }
        }
      }
    }

    // ── 4. Goldberg setup — achievements + steam_settings/ scaffolding ──
    // setupGoldberg independently honours autoSwapSteamApiDll for its
    // own DLL step, so a double-swap can't happen.
    await setupGoldberg(ctx.gameId, versionDir, { logger });

    // setupGoldberg may itself swap the DLL (when we didn't above, e.g.
    // a positively-identified Valve DLL with no DRM markers). Re-detect
    // cheaply to catch that case for the receipt. Only the DLL file is
    // re-read; no extra heavy work.
    if (!dllSwapApplied) {
      const post = findSteamApiDll(versionDir);
      if (post) {
        const ident = identifySteamApiDll(path.join(post.dllDir, post.dllName));
        if (ident.kind === "gbe") {
          // It's GBE now. We can't be 100% sure setupGoldberg swapped it
          // this run vs. a prior run, so only flag it when a backup file
          // was created in this directory.
          const backups = [".steam_backup", ".sse_backup"].some((s) =>
            fs.existsSync(path.join(post.dllDir, post.dllName + s)),
          );
          if (backups) {
            dllSwapApplied = true;
            dllSwapName = post.dllName;
          }
        }
      }
    }

    // Auto-tag multiplayer: a loader crack (OnlineFix etc.) means the game has
    // a multiplayer mode — OnlineFix spoofs the SpaceWar lobby. Steam metadata
    // often misses these, so tag from the files. connectOrCreate by the unique
    // tag name reuses the same "Multiplayer" tag the metadata path creates.
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

  return { dllSwapApplied, dllSwapName, skipped: false };
}
