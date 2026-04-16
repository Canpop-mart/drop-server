import { logger } from "~/server/internal/logging";

const RA_API_BASE = "https://retroachievements.org/API/";

export interface RAGameSearchResult {
  ID: number;
  Title: string;
  ConsoleID: number;
  ConsoleName: string;
  ImageIcon: string;
  AchievementCount: number;
}

export interface RAGameInfo {
  ID: number;
  Title: string;
  ConsoleID: number;
  ConsoleName: string;
  ImageIcon: string;
  ImageTitle: string;
  Achievements: Record<
    string,
    {
      ID: number;
      NumAwarded: number;
      NumAwardedHardcore: number;
      Unlocked: boolean;
      UnlockedHardcore: boolean;
      Title: string;
      Description: string;
      Points: number;
      BadgeName: string;
      BadgeURL: string;
      DateEarned?: string;
      DateEarnedHardcore?: string;
    }
  >;
}

export interface RAUserProgress {
  ID: number;
  Title: string;
  NumAchievements: number;
  Achievements: Record<
    string,
    {
      ID: number;
      Title: string;
      Description: string;
      Points: number;
      BadgeName: string;
      DateEarned?: string;
      DateEarnedHardcore?: string;
    }
  >;
  NumAwardedToUser: number;
  NumAwardedToUserHardcore: number;
}

export interface RAGameHashResult {
  MD5: string;
  Name: string;
  Labels: string[];
  PatchUrl: string | null;
}

export interface RAGameHashesResponse {
  Results: RAGameHashResult[];
}

export interface RARecentAchievement {
  ID: number;
  GameID: number;
  GameTitle: string;
  Title: string;
  Description: string;
  Points: number;
  BadgeName: string;
  BadgeURL: string;
  Date: string; // ISO timestamp
}

export class RetroAchievementsClient {
  private adminUsername: string;
  private adminApiKey: string;

  constructor(adminUsername: string, adminApiKey: string) {
    this.adminUsername = adminUsername;
    this.adminApiKey = adminApiKey;
  }

  private async makeRequest<T>(
    endpoint: string,
    params: Record<string, string | number> = {},
  ): Promise<T> {
    const url = new URL(endpoint, RA_API_BASE);
    url.searchParams.set("z", this.adminUsername);
    url.searchParams.set("y", this.adminApiKey);

    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, String(value));
    }

    const maxRetries = 3;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const response = await fetch(url.toString());

        if (response.status === 429) {
          if (attempt < maxRetries) {
            const delay = Math.pow(2, attempt + 1) * 1000; // 2s, 4s, 8s
            logger.warn(
              `[RA] Rate limited (429), retrying in ${delay / 1000}s (attempt ${attempt + 1}/${maxRetries})`,
            );
            await new Promise((r) => setTimeout(r, delay));
            continue;
          }
          throw new Error("RA API rate limit exceeded after retries");
        }

        if (!response.ok) {
          throw new Error(
            `RA API error: ${response.status} ${response.statusText}`,
          );
        }
        return (await response.json()) as T;
      } catch (error) {
        if (
          attempt < maxRetries &&
          error instanceof Error &&
          error.message.includes("429")
        ) {
          continue; // already handled above, but just in case
        }
        logger.error(
          `RetroAchievements API request failed: ${error instanceof Error ? error.message : String(error)}`,
        );
        throw error;
      }
    }

    throw new Error("RA API request failed after all retries");
  }

  /**
   * Search for games by name. Filters to major consoles.
   */
  async searchGame(gameName: string): Promise<RAGameSearchResult[]> {
    // Use API_GetGameList.php with search
    const results = await this.makeRequest<Record<string, RAGameSearchResult>>(
      "API_GetGameList.php",
      {
        s: gameName,
      },
    );

    // Filter results: only keep major console games (ignore hacks, homebrew, etc.)
    const allowedConsoles = [
      1, // Mega Drive/Genesis
      2, // Nintendo 64
      3, // SNES
      4, // Game Boy
      5, // NES
      6, // Master System
      7, // Turbografx-16
      8, // Game Boy Color
      9, // Wii
      10, // PS1
      12, // Atari 2600
      13, // Master System (Japan)
      14, // PS2
      15, // Dreamcast
      16, // Game Boy Advance
      17, // GameCube
      18, // Atari Lynx
      19, // Neo Geo Pocket
      20, // Game & Watch
      21, // Magnavox Odyssey
      22, // Pokemon Mini
      23, // Arcade
      24, // Virtual Boy
      25, // MSX
      26, // Commodore 64
      27, // ZX Spectrum
      28, // MSX2
      29, // Coleco Vision
      30, // Intellivision
      31, // Vectrex
      32, // Atari 5200
      33, // Ibm Pc Booter
      34, // Atari 7800
      35, // SG-1000
      36, // Supervision
      37, // Epoch Game Pocket Computer
      38, // Amstrad CPC
      39, // Apple II
      40, // Sord M5
      41, // Othello Multivision
      42, // Vic-20
      43, // Fx-9000
      44, // Pokemon Pikachu
      45, // Dos
      46, // Sega 32X
      47, // Sega CD
      48, // 3DO
      49, // Jaguar
      50, // Game Boy Pocket
      51, // Nintendo DSi
      52, // Nintendo DS
      53, // Wii U
      54, // PS Vita
      55, // PS3
      56, // Xbox
      57, // Xbox 360
      58, // Xbox One/Series
      59, // PlayStation 4
      60, // PlayStation 5
    ];

    return Object.values(results)
      .filter((game) => allowedConsoles.includes(game.ConsoleID))
      .sort((a, b) => (b.AchievementCount || 0) - (a.AchievementCount || 0));
  }

  /**
   * Get detailed game info and achievement definitions
   */
  async getGameAchievements(raGameId: number): Promise<RAGameInfo | null> {
    try {
      const result = await this.makeRequest<RAGameInfo>(
        "API_GetGameExtended.php",
        {
          i: raGameId,
        },
      );
      return result;
    } catch {
      return null;
    }
  }

  /**
   * Get a user's recent achievement unlocks
   */
  async getUserRecentAchievements(
    raUsername: string,
    raApiKey: string,
    minutes?: number,
  ): Promise<RARecentAchievement[]> {
    const url = new URL("API_GetUserRecentAchievements.php", RA_API_BASE);
    url.searchParams.set("z", this.adminUsername);
    url.searchParams.set("y", this.adminApiKey);
    url.searchParams.set("u", raUsername);
    if (minutes) {
      url.searchParams.set("m", String(minutes));
    }

    try {
      const response = await fetch(url.toString());
      if (!response.ok) {
        logger.warn(
          `RA getUserRecentAchievements failed: ${response.status} ${response.statusText}`,
        );
        return [];
      }
      const data = (await response.json()) as RARecentAchievement[];
      return Array.isArray(data) ? data : [];
    } catch (error) {
      logger.warn(
        `RA getUserRecentAchievements error: ${error instanceof Error ? error.message : String(error)}`,
      );
      return [];
    }
  }

  /**
   * Get a user's progress for a specific game
   */
  async getUserGameProgress(
    raUsername: string,
    raApiKey: string,
    raGameId: number,
  ): Promise<RAUserProgress | null> {
    const url = new URL("API_GetGameInfoAndUserProgress.php", RA_API_BASE);
    url.searchParams.set("z", this.adminUsername);
    url.searchParams.set("y", this.adminApiKey);
    url.searchParams.set("u", raUsername);
    url.searchParams.set("g", String(raGameId));

    try {
      const response = await fetch(url.toString());
      if (!response.ok) {
        logger.warn(
          `RA getUserGameProgress failed: ${response.status} ${response.statusText}`,
        );
        return null;
      }
      return (await response.json()) as RAUserProgress;
    } catch (error) {
      logger.warn(
        `RA getUserGameProgress error: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }

  /**
   * Get basic game info (title, icon, achievement count)
   */
  async getGameInfo(raGameId: number): Promise<RAGameInfo | null> {
    return this.getGameAchievements(raGameId);
  }

  /**
   * Get the supported game file hashes for a game.
   * Returns the list of known ROM hashes that RetroAchievements recognises.
   */
  async getGameHashes(raGameId: number): Promise<RAGameHashResult[]> {
    try {
      const result = await this.makeRequest<RAGameHashesResponse>(
        "API_GetGameHashes.php",
        { i: raGameId },
      );
      return result.Results ?? [];
    } catch (error) {
      logger.warn(
        `RA getGameHashes failed for game ${raGameId}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return [];
    }
  }

  /**
   * Validate RA credentials by making a test API call
   */
  async validateCredentials(
    username: string,
    apiKey: string,
  ): Promise<boolean> {
    const url = new URL("API_GetUserRecentAchievements.php", RA_API_BASE);
    url.searchParams.set("z", username);
    url.searchParams.set("y", apiKey);
    url.searchParams.set("u", username);
    url.searchParams.set("m", "1"); // 1 minute window

    try {
      const response = await fetch(url.toString());
      return response.ok;
    } catch {
      return false;
    }
  }
}

/**
 * Factory function to create a RA client with admin credentials
 */
export function createRAClient(
  adminUsername: string,
  adminApiKey: string,
): RetroAchievementsClient {
  return new RetroAchievementsClient(adminUsername, adminApiKey);
}

/**
 * Resolve RetroAchievements API credentials.
 * Priority:
 *   1. Environment variables (RA_USERNAME + RA_API_KEY)
 *   2. Specific user's linked RA account (when userId provided)
 *   3. Any user with a linked RA account (for system tasks with no user context)
 * Returns { username, apiKey } or null if no credentials are available.
 */
export async function resolveRACredentials(
  userId?: string,
): Promise<{ username: string; apiKey: string } | null> {
  const { default: prisma } = await import("~/server/internal/db/database");
  const { ExternalAccountProvider } = await import("~/prisma/client/enums");

  // 1. Try environment variables first
  const envUsername = process.env.RA_USERNAME ?? "";
  const envApiKey = process.env.RA_API_KEY ?? "";
  if (envUsername && envApiKey) {
    return { username: envUsername, apiKey: envApiKey };
  }

  // 2. Fall back to the specific user's linked RA account
  if (userId) {
    const userRa = await prisma.userExternalAccount.findUnique({
      where: {
        userId_provider: {
          userId,
          provider: ExternalAccountProvider.RetroAchievements,
        },
      },
    });
    if (userRa && userRa.externalId && userRa.token) {
      return { username: userRa.externalId, apiKey: userRa.token };
    }
  }

  // 3. Fall back to any user with linked RA credentials (for system-level tasks)
  const anyRa = await prisma.userExternalAccount.findFirst({
    where: {
      provider: ExternalAccountProvider.RetroAchievements,
      externalId: { not: "" },
      token: { not: "" },
    },
  });
  if (anyRa && anyRa.externalId && anyRa.token) {
    logger.info(
      `[RA] Using linked RA credentials from user ${anyRa.userId} (${anyRa.externalId})`,
    );
    return { username: anyRa.externalId, apiKey: anyRa.token };
  }

  return null;
}
