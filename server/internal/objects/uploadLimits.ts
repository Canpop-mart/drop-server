/**
 * Per-asset-class upload size limits. Centralised so we can swap the
 * numbers (or add a per-user override) without crawling every upload
 * endpoint.
 *
 * Sizes are bytes. Routes import the appropriate constant and pass it
 * to `enforceUploadLimit()` which throws a 413 if exceeded.
 *
 * Why per-class rather than a global cap?
 *   - Game covers are 1280x720 at most → 20MB is plenty.
 *   - Screenshots can be 4K → 50MB lets clients keep PNGs lossless.
 *   - Avatars/banners are profile chrome → 5/10MB is the sweet spot
 *     between "lets users upload a phone photo unmodified" and "stop
 *     people from uploading a 100MB raw photo".
 */
import type { H3Event, EventHandlerRequest } from "h3";

export const UPLOAD_LIMITS = {
  /** Profile avatar. Square images, usually <500KB rendered. */
  profileAvatar: 5 * 1024 * 1024,
  /** Profile banner. Wide hero image. */
  profileBanner: 10 * 1024 * 1024,
  /** Game cover / banner / icon / logo. */
  gameImage: 20 * 1024 * 1024,
  /** In-game screenshots — 4K PNGs and the like. */
  screenshot: 50 * 1024 * 1024,
  /** News article hero image. */
  newsImage: 10 * 1024 * 1024,
  /** Bug report screenshot. */
  bugReportScreenshot: 10 * 1024 * 1024,
  /** Company logo / banner. */
  companyImage: 20 * 1024 * 1024,
  /** Raw object POST (generic fallback). */
  rawObject: 50 * 1024 * 1024,
} as const;

export type UploadLimitKey = keyof typeof UPLOAD_LIMITS;

/**
 * Check Content-Length up front and bail with 413 before reading the
 * body. Clients that omit Content-Length get past this guard — the
 * caller still needs to enforce against the actual buffer size after
 * `readRawBody` / `readMultipartFormData` returns.
 *
 * Returns the configured max so callers can also enforce after-the-
 * fact:
 *
 *   const max = enforceUploadLimit(h3, "gameImage");
 *   const body = await readRawBody(h3, "binary");
 *   if (body && body.length > max) throw payloadTooLarge();
 */
export function enforceUploadLimit(
  h3: H3Event<EventHandlerRequest>,
  kind: UploadLimitKey,
): number {
  const max = UPLOAD_LIMITS[kind];
  const declared = h3.headers.get("Content-Length");
  if (declared) {
    const n = parseInt(declared, 10);
    if (Number.isFinite(n) && n > max) {
      throw createError({
        statusCode: 413,
        statusMessage: `Upload exceeds ${kind} limit of ${Math.floor(max / (1024 * 1024))}MB`,
      });
    }
  }
  return max;
}

/**
 * After-the-fact length check. Use this when the body has been
 * buffered (raw POST or multipart form) and you want a hard cap that
 * survives a missing Content-Length header.
 */
export function assertWithinLimit(
  bytes: number,
  kind: UploadLimitKey,
): void {
  const max = UPLOAD_LIMITS[kind];
  if (bytes > max) {
    throw createError({
      statusCode: 413,
      statusMessage: `Upload exceeds ${kind} limit of ${Math.floor(max / (1024 * 1024))}MB`,
    });
  }
}
