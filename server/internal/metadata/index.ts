import type { Prisma } from "~/prisma/client/client";
import type { GameType } from "~/prisma/client/enums";
import { MetadataSource } from "~/prisma/client/enums";
import prisma from "../db/database";
import type {
  _FetchGameMetadataParams,
  _FetchCompanyMetadataParams,
  GameMetadata,
  GameMetadataSearchResult,
  InternalGameMetadataResult,
  CompanyMetadata,
  GameMetadataRating,
  IMetadataProvider,
  ProviderHealth,
} from "./types";
import { ObjectTransactionalHandler } from "../objects/transactional";
import { PriorityListIndexed } from "../utils/prioritylist";
import { systemConfig } from "../config/sys-conf";
import type { TaskRunContext } from "../tasks";
import taskHandler, { wrapTaskContext } from "../tasks";
import { randomUUID } from "crypto";
import { fuzzy } from "fast-fuzzy";
import { logger } from "~/server/internal/logging";
import { createGameImportTaskId, libraryManager } from "../library";
import type { GameTagModel } from "~/prisma/client/models";
import metadataHttp from "./http";
import metadataCache from "./cache";

export class MissingMetadataProviderConfig extends Error {
  private providerName: string;

  constructor(configKey: string, providerName: string) {
    super(`Missing config item ${configKey} for ${providerName}`);
    this.providerName = providerName;
  }

  getProviderName() {
    return this.providerName;
  }
}

// Kept for back-compat with provider files that still import the constant.
// The shared HTTP client (./http.ts) sets this automatically on every
// outbound request.
export const DropUserAgent = `Drop/${systemConfig.getDropVersion()}`;

/**
 * Re-export the canonical interface so existing imports of
 * `MetadataProvider` keep working. The abstract class form is kept as a
 * convenience base; new providers should `implements MetadataProvider`
 * directly and call into `./http` + `./cache`.
 */
export type MetadataProvider = IMetadataProvider;
export abstract class AbstractMetadataProvider implements IMetadataProvider {
  abstract name(): string;
  abstract source(): MetadataSource;

  abstract search(query: string): Promise<GameMetadataSearchResult[]>;
  abstract fetchGame(
    params: _FetchGameMetadataParams,
    taskRunContext?: TaskRunContext,
  ): Promise<GameMetadata>;
  abstract fetchCompany(
    params: _FetchCompanyMetadataParams,
    taskRunContext?: TaskRunContext,
  ): Promise<CompanyMetadata | undefined>;
}

export class MetadataHandler {
  // Ordered by priority
  private providers: PriorityListIndexed<MetadataProvider> =
    new PriorityListIndexed("source");
  private objectHandler: ObjectTransactionalHandler =
    new ObjectTransactionalHandler();

  addProvider(provider: MetadataProvider, priority: number = 0) {
    this.providers.push(provider, priority);
  }

  /**
   * Returns provider IDs, used to save to applicationConfig
   * @returns The provider IDs in order, missing manual
   */
  fetchProviderIdsInOrder() {
    return this.providers
      .values()
      .map((e) => e.source())
      .filter((e) => e !== "Manual");
  }

  async search(query: string) {
    const promises: Promise<InternalGameMetadataResult[]>[] = [];
    for (const provider of this.providers.values()) {
      const queryTransformationPromise = new Promise<
        InternalGameMetadataResult[]
        // TODO: fix eslint error
        // eslint-disable-next-line no-async-promise-executor
      >(async (resolve, reject) => {
        setTimeout(
          () => reject(new Error("Timeout while fetching results")),
          systemConfig.getMetadataTimeout(),
        );
        try {
          // Provider-level cache: admin search box re-typing the same
          // query hits the cache rather than re-burning the per-provider
          // rate budget. TTL is 1h per cache.ts.
          const cacheKey = query.toLowerCase().trim();
          const cached = metadataCache.get<GameMetadataSearchResult[]>(
            provider.source(),
            "search",
            cacheKey,
          );
          const results = cached.hit
            ? cached.value
            : await provider.search(query);
          if (!cached.hit) {
            metadataCache.set(provider.source(), "search", cacheKey, results);
          }
          const mappedResults: InternalGameMetadataResult[] = results.map(
            (result) =>
              Object.assign({}, result, {
                sourceId: provider.source(),
                sourceName: provider.name(),
              }),
          );
          resolve(mappedResults);
        } catch (e) {
          logger.warn(`[metadata:${provider.source()}] search failed: ${e}`);
          reject(e);
        }
      });
      promises.push(queryTransformationPromise);
    }

    const results = await Promise.allSettled(promises);
    const successfulResults = results
      .filter((result) => result.status === "fulfilled")
      .map((result) => result.value)
      .flat()
      .map((result) => {
        const match = fuzzy(query, result.name);
        return { ...result, fuzzy: match };
      })
      .sort((a, b) => b.fuzzy - a.fuzzy);

    return successfulResults;
  }

  /**
   * Per-provider health status. Used by `pages/admin/metadata/index.vue`
   * and exposed via `GET /api/v1/admin/metadata/health`.
   *
   * Status reflects the shared HTTP client's tally + any explicit override
   * from `metadataHttp.setStatus` (e.g. "unauthenticated" if a provider
   * constructor noticed missing creds, "rate-limited" after a 429).
   */
  async healthCheck(): Promise<ProviderHealth[]> {
    const results: ProviderHealth[] = [];
    for (const provider of this.providers.values()) {
      const status = provider.health
        ? await provider.health().catch(() => "down" as const)
        : metadataHttp.status(provider.name());
      results.push({
        source: provider.source(),
        name: provider.name(),
        status,
        stats: metadataHttp.getStatsSnapshot(provider.name()),
      });
    }
    return results;
  }

  /**
   * Cache hit-rate snapshot for the admin debug page. The cache is
   * process-local so this is a per-instance number, not a cluster
   * aggregate.
   */
  cacheStats() {
    return metadataCache.stats();
  }

  async createGameWithoutMetadata(
    libraryId: string,
    libraryPath: string,
    type: GameType,
    discFolders?: string[],
    parentTask?: TaskRunContext,
  ) {
    return await this.createGame(
      {
        id: "",
        name: libraryPath,
        sourceId: MetadataSource.Manual,
      },
      libraryId,
      libraryPath,
      type,
      discFolders,
      parentTask,
    );
  }

  private async parseTags(tags: string[]) {
    if (tags.length === 0) return [];

    // Parallelize tag lookups
    const tagResults = await Promise.all(
      tags.map(async (tag) => {
        const rawResults: GameTagModel[] =
          await prisma.$queryRaw`SELECT * FROM "GameTag" WHERE SIMILARITY(name, ${tag}) > 0.45;`;
        return { tag, result: rawResults.at(0) };
      }),
    );

    // Batch create missing tags
    const tagsToCreate = tagResults
      .filter(({ result }) => !result)
      .map(({ tag }) => ({ name: tag }));

    if (tagsToCreate.length > 0) {
      await prisma.gameTag.createMany({
        data: tagsToCreate,
        skipDuplicates: true,
      });
    }

    // Re-fetch created tags to get their IDs
    const results: Array<GameTagModel> = [];
    for (const { tag, result } of tagResults) {
      if (result) {
        results.push(result);
      } else {
        const newTag = await prisma.gameTag.findFirst({
          where: { name: tag },
        });
        if (newTag) {
          results.push(newTag);
        }
      }
    }

    return results;
  }

  private parseRatings(ratings: GameMetadataRating[]) {
    const results: Array<Prisma.GameRatingCreateOrConnectWithoutGameInput> = [];

    ratings.forEach((r) => {
      results.push({
        where: {
          metadataKey: {
            metadataId: r.metadataId,
            metadataSource: r.metadataSource,
          },
        },
        create: {
          ...r,
        },
      });
    });

    return results;
  }

  /**
   * Creates a Game row (+ objects) inside an import task, walking the
   * provider fallback chain for metadata.
   *
   * Returns `{ taskId, gameId }` — the gameId is generated up-front so
   * callers can chain a first-version import without waiting to read it
   * back. Returns `undefined` for a duplicate (metadataKey collision).
   *
   * `parentTask` is optional and trailing — passing it nests the import
   * under an existing task (used by the one-click "import game + first
   * version" flow). Existing callers that omit it are unaffected.
   */
  async createGame(
    result: { sourceId: string; id: string; name: string },
    libraryId: string,
    libraryPath: string,
    type: GameType,
    discFolders?: string[],
    parentTask?: TaskRunContext,
  ): Promise<{ taskId: string; gameId: string } | undefined> {
    const primary = this.providers.get(result.sourceId);
    if (!primary)
      throw new Error(`Invalid metadata provider for ID "${result.sourceId}"`);

    const existing = await prisma.game.findUnique({
      where: {
        metadataKey: {
          metadataSource: primary.source(),
          metadataId: result.id,
        },
      },
    });
    if (existing) return undefined;

    const gameId = randomUUID();

    // Fallback chain: try the user-selected provider first, then walk
    // every other configured provider (skipping Manual — that always
    // succeeds with a no-op and would mask real failures). The first one
    // that returns a usable result wins. Each failure is logged loudly
    // so admins can see why their chosen provider didn't work.
    //
    // Note: secondary providers are only useful if they can find the
    // game by *name*, since the `id` we have is specific to the primary
    // provider's namespace. We pass the search result name through and
    // each provider's `fetchGame` is expected to accept that as a query
    // when its id-shaped argument doesn't match — pcgamingwiki/giantbomb
    // both already handle this, IGDB falls back to its numeric-id check.
    const fallbackChain: MetadataProvider[] = [primary];
    for (const p of this.providers.values()) {
      if (
        p.source() !== primary.source() &&
        p.source() !== MetadataSource.Manual
      ) {
        fallbackChain.push(p);
      }
    }

    const key = createGameImportTaskId(libraryId, libraryPath);
    const taskId = await taskHandler.create(
      {
        name: `Import game "${result.name}" (${libraryPath})`,
        key,
        taskGroup: "import:game",
        acls: ["system:import:game:read"],
        async run(context) {
          const { progress, logger } = context;

          progress(0);

          // The transactional handler is re-issued per fallback attempt
          // so a failed provider's half-registered image refs don't leak
          // into the successful provider's payload. We keep a single ref
          // object pointing at the current transaction so the close-over
          // `company` callback always uses the live createObject.
          const tx = (() => {
            const [createObject, pullObjects, dumpObjects] =
              metadataHandler.objectHandler.new(
                {},
                ["internal:read"],
                wrapTaskContext(context, {
                  min: 60,
                  max: 95,
                  prefix: "[object import] ",
                }),
              );
            return { createObject, pullObjects, dumpObjects };
          })();

          const companyLookupCache: {
            [key: string]: Awaited<
              ReturnType<typeof metadataHandler.fetchCompany>
            >;
          } = {};
          let metadata: GameMetadata | undefined = undefined;
          let chosen: MetadataProvider | undefined = undefined;
          const chainErrors: string[] = [];
          for (const candidate of fallbackChain) {
            try {
              const fetchId =
                candidate.source() === primary.source()
                  ? result.id
                  : result.name;
              logger.info(
                `[fallback] trying ${candidate.name()} (id="${fetchId}")`,
              );
              metadata = await candidate.fetchGame(
                {
                  id: fetchId,
                  name: result.name,
                  company: async (name: string) => {
                    if (companyLookupCache[name])
                      return companyLookupCache[name];

                    const companyData =
                      await metadataHandler.fetchCompany(name);
                    companyLookupCache[name] = companyData;
                    return companyData;
                  },
                  createObject: (data) => tx.createObject(data),
                },
                wrapTaskContext(context, {
                  min: 0,
                  max: 60,
                  prefix: `[metadata:${candidate.name()}] `,
                }),
              );
              chosen = candidate;
              break;
            } catch (e) {
              const msg = e instanceof Error ? e.message : String(e);
              chainErrors.push(`${candidate.name()}: ${msg}`);
              logger.warn(
                `[fallback] ${candidate.name()} failed: ${msg} — trying next provider`,
              );
              // Reset the transaction so the next provider starts clean.
              await tx.dumpObjects();
              const [createObject, pullObjects, dumpObjects] =
                metadataHandler.objectHandler.new(
                  {},
                  ["internal:read"],
                  wrapTaskContext(context, {
                    min: 60,
                    max: 95,
                    prefix: "[object import] ",
                  }),
                );
              tx.createObject = createObject;
              tx.pullObjects = pullObjects;
              tx.dumpObjects = dumpObjects;
            }
          }
          if (!metadata || !chosen) {
            await tx.dumpObjects();
            throw new Error(
              `All ${fallbackChain.length} metadata providers failed for "${result.name}":\n  ${chainErrors.join("\n  ")}`,
            );
          }
          if (chosen.source() !== primary.source()) {
            logger.info(
              `[fallback] primary "${primary.name()}" failed; succeeded with "${chosen.name()}"`,
            );
          }

          context?.progress(60);

          logger.info(`Successfully fetched all metadata.`);
          logger.info(`Importing objects...`);

          await tx.pullObjects();

          progress(95);

          await prisma.game.create({
            data: {
              id: gameId,
              metadataSource: chosen.source(),
              metadataId: metadata.id,

              mName: metadata.name,
              mShortDescription: metadata.shortDescription,
              mDescription: metadata.description,
              mReleased: metadata.released,

              mIconObjectId: metadata.icon,
              mBannerObjectId: metadata.bannerId,
              mCoverObjectId: metadata.coverId,
              mLogoObjectId: metadata.logoId,
              mImageLibraryObjectIds: metadata.images,
              // Auto-populate carousel with gameplay screenshots only (no
              // banners, covers, or promotional artwork)
              mImageCarouselObjectIds: metadata.screenshots.slice(0, 10),

              publishers: {
                // Defensive: drop any company that failed to resolve so a
                // single bad publisher/developer can't reject the whole import.
                connect: metadata.publishers.filter(Boolean),
              },
              developers: {
                connect: metadata.developers.filter(Boolean),
              },

              ratings: {
                connectOrCreate: metadataHandler.parseRatings(metadata.reviews),
              },
              tags: {
                connect: await metadataHandler.parseTags(metadata.tags),
              },

              libraryId,
              libraryPath,
              discFolders: discFolders ?? [],

              type,
            },
          });

          // The game is now imported — drop the unimported-games scan
          // cache so it stops appearing in the admin import picker.
          libraryManager.bustUnimportedGamesCache(libraryId);

          logger.info(`Finished game import.`);
          progress(100);

          context.addAction(`View Game:/admin/library/${gameId}`);
        },
      },
      parentTask,
    );
    return { taskId, gameId };
  }

  // Careful with this function, it has no typechecking
  // Type-checking this thing is impossible
  //
  // `fetchCompany` walks every provider until one resolves the company.
  // The 2026 audit added a miss cache: a single import of a multi-studio
  // game used to re-ask all providers about a genuinely-unknown indie
  // publisher once per related game. We now cache misses for 1 day
  // (cache.ts → "company-miss"). Hits are still served from Postgres
  // (`metadataOriginalQuery`) so they never go stale.
  private async fetchCompany(query: string) {
    const existing = await prisma.company.findFirst({
      where: {
        metadataOriginalQuery: query,
      },
    });
    if (existing) return existing;

    // Don't re-ask providers for a company we recently failed to find.
    const cacheKey = query.toLowerCase().trim();
    const missCached = metadataCache.get<true>(
      "metadataHandler",
      "company-miss",
      cacheKey,
    );
    if (missCached.hit) {
      logger.info(
        `[metadata] skipping company lookup for "${query}" — recent miss is cached`,
      );
      return undefined;
    }

    for (const provider of this.providers.values()) {
      // don't allow manual provider to "fetch" metadata
      if (provider.source() === MetadataSource.Manual) continue;

      const [createObject, pullObjects, dumpObjects] = this.objectHandler.new(
        {},
        ["internal:read"],
      );
      let result: CompanyMetadata | undefined;
      try {
        result = await provider.fetchCompany({ query, createObject });
        if (result === undefined) {
          throw new Error(
            `${provider.source()} failed to find a company for "${query}"`,
          );
        }
      } catch (e) {
        logger.warn(
          `[metadata:${provider.source()}] company lookup for "${query}" failed: ${
            e instanceof Error ? e.message : e
          }`,
        );
        await dumpObjects();
        continue;
      }

      const object = await prisma.company.upsert({
        where: {
          metadataKey: {
            metadataSource: provider.source(),
            metadataId: result.id,
          },
        },
        create: {
          metadataSource: provider.source(),
          metadataId: result.id,
          metadataOriginalQuery: query,

          mName: result.name,
          mShortDescription: result.shortDescription,
          mDescription: result.description,
          mLogoObjectId: result.logo,
          mBannerObjectId: result.banner,
          mWebsite: result.website,
        },
        update: {},
      });

      if (object.mLogoObjectId == result.logo) {
        // We created, and didn't update
        // So pull objects
        await pullObjects();
      }

      return object;
    }

    // Every provider struck out — remember the miss so the next imported
    // game with this same company doesn't repeat the whole walk.
    metadataCache.set("metadataHandler", "company-miss", cacheKey, true);
    logger.warn(
      `[metadata] no provider could resolve company "${query}" — caching miss for 1 day`,
    );
    return undefined;
  }
}

export const metadataHandler = new MetadataHandler();
export default metadataHandler;
