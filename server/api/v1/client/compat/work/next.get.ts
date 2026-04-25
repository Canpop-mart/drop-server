import { defineClientEventHandler } from "~/server/internal/clients/event-handler";
import prisma from "~/server/internal/db/database";
import { Platform } from "~/prisma/client/enums";

const STALE_DAYS = 60;

/**
 * Returns the next game the calling client should compatibility-test, or
 * 204 if nothing is queued. Drives the drop-client batch worker (Phase D2).
 *
 * "Next" = a game in the user's library that this specific client has
 * either never tested OR last tested more than `STALE_DAYS` days ago.
 * Stale results get retested because a working game can break across
 * Wine/Proton/game updates, and a broken game might have been fixed.
 *
 * Stateless — no row locking, no queue table. Multiple clients of
 * different platforms can poll independently and won't collide because
 * results are scoped by clientId.
 *
 * Optional `?platform=Linux` filter narrows the candidate pool (e.g. a
 * Steam Deck worker doesn't want to be handed a Windows-only game).
 * Note: there's no platform field on Game yet — the filter currently
 * just confirms the worker is reporting from the platform it claims to
 * be, no candidate pruning. Keeps the contract forward-compatible.
 */
export default defineClientEventHandler(async (h3, { clientId, fetchUser }) => {
  const query = getQuery(h3);
  const platformParam =
    typeof query.platform === "string"
      ? (query.platform as Platform)
      : undefined;

  const user = await fetchUser();

  // Find a game in the user's library that this client either hasn't
  // tested yet OR last tested before the staleness threshold.
  // Single query: NOT EXISTS (recent result) → ordered by mReleased desc
  // so newer games get triaged first (more likely to be the games the
  // user actually cares about right now).
  const candidate = await prisma.$queryRaw<
    Array<{
      id: string;
      mName: string;
      metadataId: string;
      lastTestedAt: Date | null;
    }>
  >`
    SELECT g.id,
           g."mName",
           g."metadataId",
           latest."testedAt" AS "lastTestedAt"
    FROM "Game" g
    LEFT JOIN LATERAL (
      SELECT "testedAt"
      FROM "GameCompatibilityResult" r
      WHERE r."gameId" = g.id AND r."clientId" = ${clientId}
      ORDER BY r."testedAt" DESC
      LIMIT 1
    ) latest ON TRUE
    WHERE EXISTS (
      -- The game must be in the user's library. We approximate this as
      -- "any client owned by this user has it installed" OR "it's in
      -- their default library." For self-hosted instances both are fine.
      SELECT 1 FROM "Client" c
      WHERE c."userId" = ${user.id}
        AND EXISTS (
          SELECT 1 FROM "ClientInstalledGame" cig
          WHERE cig."clientId" = c.id AND cig."gameId" = g.id
        )
    )
    AND (
      latest."testedAt" IS NULL
      OR latest."testedAt" < NOW() - (${STALE_DAYS} || ' days')::INTERVAL
    )
    ORDER BY g."mReleased" DESC NULLS LAST
    LIMIT 1
  `;

  if (candidate.length === 0) {
    setResponseStatus(h3, 204);
    return null;
  }

  const game = candidate[0];
  return {
    gameId: game.id,
    name: game.mName,
    metadataId: game.metadataId,
    lastTestedAt: game.lastTestedAt?.toISOString() ?? null,
    // Echo back the platform so the worker can sanity-check it didn't
    // get handed an item meant for a different OS.
    platform: platformParam ?? null,
  };
});
