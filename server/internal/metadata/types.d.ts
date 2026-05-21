import type { Company, GameRating } from "~/prisma/client";
import type { MetadataSource } from "~/prisma/client/enums";
import type { TransactionDataType } from "../objects/transactional";
import type { ObjectReference } from "../objects/objectHandler";
import type { TaskRunContext } from "../tasks";
import type { ProviderHealthStatus, ProviderStats } from "./http";

export interface GameMetadataSearchResult {
  id: string;
  name: string;
  icon: string;
  description: string;
  year: number;
}

export interface GameMetadataSource {
  sourceId: string;
  sourceName: string;
}

export type InternalGameMetadataResult = GameMetadataSearchResult &
  GameMetadataSource;

export type GameMetadataRating = Pick<
  GameRating,
  | "metadataSource"
  | "metadataId"
  | "mReviewCount"
  | "mReviewHref"
  | "mReviewRating"
>;

export interface GameMetadata {
  id: string;
  name: string;
  shortDescription: string;
  description: string;
  released: Date;

  // These are created using utility functions passed to the metadata loader
  // (that then call back into the metadata provider chain)
  publishers: Company[];
  developers: Company[];

  tags: string[];

  reviews: GameMetadataRating[];

  // Created with another utility function
  icon: ObjectReference;
  bannerId: ObjectReference;
  coverId: ObjectReference;
  logoId: ObjectReference;
  images: ObjectReference[];
  /** Gameplay screenshots only — used for the store carousel */
  screenshots: ObjectReference[];
}

export interface CompanyMetadata {
  id: string;
  name: string;
  shortDescription: string;
  description: string;

  logo: ObjectReference;
  banner: ObjectReference;
  website: string;
}

export interface _FetchGameMetadataParams {
  id: string;
  name: string;

  company: (query: string) => Promise<Company | undefined>;

  createObject: (data: TransactionDataType) => ObjectReference;
}

export interface _FetchCompanyMetadataParams {
  query: string;
  createObject: (data: TransactionDataType) => ObjectReference;
}

/**
 * Canonical interface implemented by every metadata provider.
 *
 * The abstract class in `index.ts` re-exports this so existing code that
 * `extends MetadataProvider` still works; new providers should `implements
 * IMetadataProvider` and reuse helpers from `./http` + `./cache` rather
 * than rolling their own retry / timeout / rate-limit logic.
 *
 * - `name()` is the human-facing label ("Steam", "IGDB"). Used in logs,
 *   admin UI, and as the per-provider rate-limit key in `./http.ts` —
 *   keep them in sync.
 * - `source()` is the `MetadataSource` enum value persisted with Game /
 *   Company / GameRating rows. Used as the registry index.
 * - `search()` returns lightweight stubs for the admin import flow's
 *   "did you mean this game?" search box.
 * - `fetchGame()` produces a fully-populated `GameMetadata`. Object
 *   references are registered into the calling transactional object
 *   handler — callers MUST eventually pull or dump that transaction.
 * - `fetchCompany()` may return undefined (provider couldn't find that
 *   company). The orchestrator caches the miss for 1 day so the chain
 *   doesn't re-ask everyone on the next import.
 * - `health()` is optional. Providers that can do a cheap auth-check
 *   ping (IGDB token refresh, Steam community search) implement it; the
 *   default falls back to "infer from request stats in metadataHttp".
 */
export interface IMetadataProvider {
  name(): string;
  source(): MetadataSource;

  search(query: string): Promise<GameMetadataSearchResult[]>;
  fetchGame(
    params: _FetchGameMetadataParams,
    taskRunContext?: TaskRunContext,
  ): Promise<GameMetadata>;
  fetchCompany(
    params: _FetchCompanyMetadataParams,
    taskRunContext?: TaskRunContext,
  ): Promise<CompanyMetadata | undefined>;

  /** Optional — cheap upstream auth-check ping. */
  health?(): Promise<ProviderHealthStatus>;
}

export interface ProviderHealth {
  source: MetadataSource;
  name: string;
  status: ProviderHealthStatus;
  stats: ProviderStats;
}
