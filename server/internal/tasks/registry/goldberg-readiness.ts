import { defineDropTask } from "..";
import prisma from "../../db/database";
import { ExternalAccountProvider } from "~/prisma/client/enums";
import {
  readGoldbergAppId,
  readGoldbergDefinitions,
  resolveGameVersionDir,
  setupGoldberg,
} from "../../goldberg";
import { findSteamApiDll, identifySteamApiDll } from "../../gbe";
import fs from "fs";
import path from "path";

/**
 * Walks every Steam / Goldberg-linked game and verifies the files Goldberg
 * needs at runtime (steam_settings/, steam_appid.txt, achievements.json) plus
 * the matching DB rows. Any gap triggers a `setupGoldberg` pass to regenerate.
 *
 * Split out of the former `scan:achievements` umbrella so a failure here
 * doesn't block definition refresh or RA linking.
 *
 * DLL-swap policy (changed alongside the gbe.ts inversion):
 *   - Only flags "non-GBE DLL" as a readiness issue when the DLL was
 *     **positively identified as Valve** AND the library/game has
 *     auto-swap enabled. Pre-applied crack DLLs (OnlineFix, CODEX,
 *     EMPRESS, CreamAPI…) and unidentifiable customs are explicitly NOT
 *     flagged — that was the old opt-out behaviour that destroyed
 *     working installs.
 */
export default defineDropTask({
  buildId: () => `scan:goldberg-readiness:${new Date().toISOString()}`,
  name: "Scan Goldberg Readiness",
  acls: ["system:maintenance:read"],
  taskGroup: "scan:goldberg-readiness",

  async run({ progress, logger }) {
    const games = await prisma.game.findMany({
      where: {
        OR: [
          {
            externalLinks: {
              some: { provider: ExternalAccountProvider.Goldberg },
            },
          },
          { metadataSource: "Steam" },
        ],
      },
      select: {
        id: true,
        mName: true,
        metadataSource: true,
        metadataId: true,
        autoSwapSteamApiDll: true,
        library: { select: { autoSwapSteamApiDll: true } },
        externalLinks: {
          where: { provider: ExternalAccountProvider.Goldberg },
          select: { externalGameId: true },
        },
        _count: { select: { achievements: true } },
      },
    });

    logger.info(`Checking ${games.length} Steam/Goldberg game(s)`);

    let healthy = 0;
    let fixed = 0;
    let issues = 0;
    let leftAlone = 0;

    for (let i = 0; i < games.length; i++) {
      const game = games[i];
      const appId =
        game.externalLinks[0]?.externalGameId ??
        (game.metadataSource === "Steam" ? game.metadataId : null);

      if (!appId) {
        logger.info(`${game.mName} — no AppID, skipping`);
        progress(Math.round(((i + 1) / games.length) * 100));
        continue;
      }

      const versionDir = await resolveGameVersionDir(game.id);
      if (!versionDir) {
        logger.info(`${game.mName} — no version directory, skipping`);
        progress(Math.round(((i + 1) / games.length) * 100));
        continue;
      }

      const hasAppIdFile = !!readGoldbergAppId(versionDir);
      const hasAchievementsFile =
        readGoldbergDefinitions(versionDir).length > 0;
      const hasDbRecords = game._count.achievements > 0;
      const hasSteamSettings = fs.existsSync(
        path.join(versionDir, "steam_settings"),
      );

      // Verify whether the steam_api DLL needs the GBE swap. The check
      // is now opt-in (positive identification required) — see
      // identifySteamApiDll in gbe.ts. We only treat "should be GBE but
      // isn't" as a readiness gap when:
      //   1. The library / game has autoSwap enabled.
      //   2. The DLL is positively identified as vanilla Valve.
      // Known cracks and unidentifiable customs are LEFT IN PLACE so
      // we don't clobber pre-applied OnlineFix / CODEX / EMPRESS DLLs.
      const effectiveAutoSwap =
        game.autoSwapSteamApiDll ??
        game.library?.autoSwapSteamApiDll ??
        true;

      const dllInfo = findSteamApiDll(versionDir);
      let needsGbeSwap = false;
      let dllNote = "";
      if (dllInfo) {
        const ident = identifySteamApiDll(
          path.join(dllInfo.dllDir, dllInfo.dllName),
        );
        dllNote = `${dllInfo.dllName} kind=${ident.kind} (${ident.fingerprint})`;
        if (!effectiveAutoSwap) {
          dllNote += " — auto-swap disabled, treating as healthy regardless";
        } else if (ident.kind === "valve") {
          needsGbeSwap = true;
        } else if (ident.kind === "known-crack" || ident.kind === "unknown") {
          dllNote +=
            " — leaving in place (refusing to overwrite pre-applied crack/unknown DLL)";
          leftAlone++;
        }
      }

      const allGood =
        hasAppIdFile &&
        hasAchievementsFile &&
        hasDbRecords &&
        hasSteamSettings &&
        !needsGbeSwap;

      if (allGood) {
        if (dllNote) logger.info(`${game.mName} — healthy. ${dllNote}`);
        healthy++;
      } else {
        const missing: string[] = [];
        if (!hasSteamSettings) missing.push("steam_settings/");
        if (!hasAppIdFile) missing.push("steam_appid.txt");
        if (!hasAchievementsFile) missing.push("achievements.json");
        if (!hasDbRecords) missing.push("DB records");
        if (needsGbeSwap)
          missing.push("GBE DLL swap (vanilla Valve detected)");
        logger.info(
          `${game.mName} — missing: ${missing.join(", ")}. ${dllNote ? dllNote + ". " : ""}Running setup...`,
        );

        try {
          await setupGoldberg(game.id, versionDir, {
            forceRefreshAchievements: true,
            logger,
          });
          const dbCount = await prisma.achievement.count({
            where: { gameId: game.id },
          });
          logger.info(`${game.mName} — fixed (${dbCount} achievements in DB)`);
          fixed++;
        } catch (e) {
          logger.info(`${game.mName} — setup failed: ${e}`);
          issues++;
        }
      }

      progress(Math.round(((i + 1) / games.length) * 100));
      await new Promise((r) => setTimeout(r, 200));
    }

    logger.info(
      `Goldberg readiness: ${healthy} healthy, ${fixed} fixed, ` +
        `${leftAlone} left alone (pre-existing crack / unknown DLL), ` +
        `${issues} issue(s) across ${games.length} game(s)`,
    );
  },
});
