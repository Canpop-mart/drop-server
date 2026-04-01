import { defineDropTask } from "..";
import prisma from "../../db/database";
import { MetadataSource } from "~/prisma/client/enums";

/**
 * Fetches the current public build ID for a Steam app from the SteamCMD API.
 * Returns null if the request fails or the build ID cannot be found.
 */
async function fetchSteamBuildId(appId: string): Promise<string | null> {
  try {
    const response = await fetch(`https://api.steamcmd.net/v1/info/${appId}`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return null;

    const json = (await response.json()) as Record<string, unknown>;
    if (json.status !== "success") return null;

    const data = json.data as Record<string, unknown> | undefined;
    const appData = data?.[appId] as Record<string, unknown> | undefined;
    const depots = appData?.depots as Record<string, unknown> | undefined;
    const branches = depots?.branches as Record<string, unknown> | undefined;
    const pub = branches?.public as Record<string, unknown> | undefined;
    const buildId = pub?.buildid;

    return typeof buildId === "string" ? buildId : null;
  } catch {
    return null;
  }
}

export default defineDropTask({
  buildId: () => `check:game-updates:${new Date().toISOString()}`,
  name: "Check for Game Updates",
  acls: ["system:maintenance:read"],
  taskGroup: "check:game-updates",

  async run({ progress, logger }) {
    logger.info("Starting game update check");

    // Only Steam-sourced games can be checked — metadataId = Steam App ID
    const games = await prisma.game.findMany({
      where: { metadataSource: MetadataSource.Steam },
      select: {
        id: true,
        mName: true,
        metadataId: true,
        versions: {
          select: { versionPath: true },
          orderBy: { versionIndex: "desc" },
          take: 1,
        },
      },
    });

    if (games.length === 0) {
      logger.info("No Steam-sourced games found, nothing to check");
      progress(100);
      return;
    }

    logger.info(`Checking ${games.length} Steam game(s) for updates`);

    let checked = 0;
    let updatesFound = 0;

    for (const game of games) {
      const currentBuildId = game.versions[0]?.versionPath ?? null;

      if (!currentBuildId) {
        logger.info(
          `Skipping ${game.mName} — no version path recorded (no versions imported yet)`,
        );
        checked++;
        progress(Math.round((checked / games.length) * 90));
        continue;
      }

      const latestBuildId = await fetchSteamBuildId(game.metadataId);

      if (latestBuildId === null) {
        logger.info(
          `Could not fetch build ID for ${game.mName} (appId: ${game.metadataId})`,
        );
        checked++;
        progress(Math.round((checked / games.length) * 90));
        continue;
      }

      const hasUpdate = latestBuildId !== currentBuildId;

      await prisma.game.update({
        where: { id: game.id },
        data: { updateAvailable: hasUpdate },
      });

      if (hasUpdate) {
        updatesFound++;
        logger.info(
          `Update available for ${game.mName}: stored=${currentBuildId} latest=${latestBuildId}`,
        );
      } else {
        logger.info(`${game.mName} is up to date (buildId: ${currentBuildId})`);
      }

      checked++;
      progress(Math.round((checked / games.length) * 90));

      // Small delay to be polite to the Steam API
      await new Promise((r) => setTimeout(r, 300));
    }

    logger.info(
      `Done — ${updatesFound} update(s) available across ${games.length} game(s)`,
    );
    progress(100);
  },
});
