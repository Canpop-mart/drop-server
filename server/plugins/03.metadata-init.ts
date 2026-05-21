import { applicationSettings } from "../internal/config/application-configuration";
import type { MetadataProvider } from "../internal/metadata";
import metadataHandler from "../internal/metadata";
import { IGDBProvider } from "../internal/metadata/igdb";
import { ManualMetadataProvider } from "../internal/metadata/manual";
import { PCGamingWikiProvider } from "../internal/metadata/pcgamingwiki";
import { SteamProvider } from "../internal/metadata/steam";
import { GiantBombProvider } from "../internal/metadata/giantbomb";
import { logger } from "~/server/internal/logging";

export default defineNitroPlugin(async (_nitro) => {
  // Each provider's constructor throws MissingMetadataProviderConfig if
  // its required env vars are absent — the try/catch below turns that
  // into a skipped provider rather than a boot failure. So GiantBomb is
  // listed here but only actually registers when GIANT_BOMB_API_KEY is
  // set. (The 2026 metadata audit re-wired it through the shared HTTP
  // client; it is no longer dead code.)
  const metadataProviders = [
    SteamProvider,
    PCGamingWikiProvider,
    IGDBProvider,
    GiantBombProvider,
  ];

  const providers = new Map<string, MetadataProvider>();

  for (const provider of metadataProviders) {
    try {
      const prov = new provider();
      const id = prov.source();
      providers.set(id, prov);

      logger.info(`enabled metadata provider: ${prov.name()}`);
    } catch (e) {
      logger.warn(`skipping metadata provider setup: ${e}`);
    }
  }

  // Add providers based on their position in the application settings
  const configuredProviderList =
    await applicationSettings.get("metadataProviders");
  const max = configuredProviderList.length;
  for (const [index, providerId] of configuredProviderList.entries()) {
    const priority = max * 2 - index; // Offset by the length --- (max - index) + max
    const provider = providers.get(providerId);
    if (!provider) {
      logger.warn(`failed to add existing metadata provider: ${providerId}`);
      continue;
    }
    metadataHandler.addProvider(provider, priority);
    providers.delete(providerId);
  }

  // Add the rest with no position
  for (const [, provider] of providers.entries()) {
    metadataHandler.addProvider(provider);
  }

  metadataHandler.addProvider(new ManualMetadataProvider(), -1000);

  // Update the applicatonConfig
  await applicationSettings.set(
    "metadataProviders",
    metadataHandler.fetchProviderIdsInOrder(),
  );
});
