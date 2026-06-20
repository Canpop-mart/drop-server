import { readFileSync } from "node:fs";
import normalizeUrl from "normalize-url";

class SystemConfig {
  private libraryFolder = process.env.LIBRARY ?? "./.data/library";
  private dataFolder = process.env.DATA ?? "./.data/data";

  // ZeroTier co-op rooms. The feature is enabled only when both a controller
  // URL and an auth token resolve. Token is read inline (ZEROTIER_AUTH_TOKEN)
  // or from a file (ZEROTIER_AUTH_TOKEN_PATH) — see docs/zerotier-controller.md.
  private zerotierControllerUrl =
    process.env.ZEROTIER_CONTROLLER_URL?.trim() || undefined;
  private zerotierAuthToken = resolveZerotierToken();

  private metadataTimeout = parseInt(process.env.METADATA_TIMEOUT ?? "5000");

  private externalUrl = normalizeUrl(
    process.env.EXTERNAL_URL ?? "http://localhost:3000",
    { stripWWW: false },
  );
  private dropVersion: string;
  private gitRef: string;
  private oidcRequireHttps;

  private checkForUpdates = getUpdateCheckConfig();

  constructor() {
    // get drop version and git ref from nuxt config
    const config = useRuntimeConfig();
    this.dropVersion = config.dropVersion;
    this.gitRef = config.gitRef;

    const oidcRequireHttps = process.env.OIDC_REQUIRE_HTTPS as
      | string
      | undefined;

    // default to true if not set
    this.oidcRequireHttps =
      oidcRequireHttps !== undefined &&
      oidcRequireHttps.toLocaleLowerCase() === "false"
        ? false
        : true;

    // Validate EXTERNAL_URL in production
    if (process.env.NODE_ENV === "production" && !process.env.EXTERNAL_URL) {
      throw new Error(
        "EXTERNAL_URL environment variable is required in production. Set it to your server's public URL (e.g. https://drop.example.com).",
      );
    }

    console.log(`[CONFIG] External URL: ${this.externalUrl}`);
  }

  getLibraryFolder() {
    return this.libraryFolder;
  }

  getDataFolder() {
    return this.dataFolder;
  }

  getMetadataTimeout() {
    return this.metadataTimeout;
  }

  getDropVersion() {
    return this.dropVersion;
  }

  getGitRef() {
    return this.gitRef;
  }

  shouldCheckForUpdates() {
    return this.checkForUpdates;
  }

  getExternalUrl() {
    return this.externalUrl;
  }

  // if oidc should require https for endpoints
  shouldOidcRequireHttps() {
    return this.oidcRequireHttps;
  }

  getZerotierControllerUrl() {
    return this.zerotierControllerUrl;
  }

  getZerotierAuthToken() {
    return this.zerotierAuthToken;
  }

  // Co-op rooms are available only when the controller URL + auth token resolve.
  isZerotierEnabled() {
    return Boolean(this.zerotierControllerUrl && this.zerotierAuthToken);
  }
}

export const systemConfig = new SystemConfig();

/**
 * Resolves the ZeroTier controller auth token from the inline env var, falling
 * back to a file path. Returns undefined (feature disabled) if neither yields a
 * value — a missing file is not fatal.
 */
function resolveZerotierToken(): string | undefined {
  const inline = process.env.ZEROTIER_AUTH_TOKEN?.trim();
  if (inline) return inline;

  const path = process.env.ZEROTIER_AUTH_TOKEN_PATH?.trim();
  if (!path) return undefined;
  try {
    const token = readFileSync(path, "utf-8").trim();
    return token || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Gets the configuration for checking updates based on various conditions
 * @returns true if updates should be checked, false otherwise.
 */
function getUpdateCheckConfig(): boolean {
  const envCheckUpdates = process.env.CHECK_FOR_UPDATES;

  // Check environment variable
  if (envCheckUpdates !== undefined) {
    // if explicitly set to true or false, return that value
    if (envCheckUpdates.toLocaleLowerCase() === "true") {
      return true;
    } else if (envCheckUpdates.toLocaleLowerCase() === "false") {
      return false;
    }
  } else if (process.env.NODE_ENV === "production") {
    // default to true in production
    return true;
  }

  return false;
}
