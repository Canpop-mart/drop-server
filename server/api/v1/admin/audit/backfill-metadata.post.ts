import aclManager from "~/server/internal/acls";
import prisma from "~/server/internal/db/database";
import { taskHandler } from "~/server/internal/tasks";
import metadataHttp from "~/server/internal/metadata/http";
import { fetchHltbTimes } from "~/server/internal/metadata/hltb";
import { MetadataSource, ControllerSupport } from "~/prisma/client/enums";
import type { Prisma } from "~/prisma/client/client";

/**
 * Re-fetch just Steam's controller_support for one appid (the same signal the
 * Steam provider reads at import). Returns None on any miss so the caller can
 * skip writing.
 */
async function fetchSteamControllerSupport(
  appid: string,
): Promise<ControllerSupport> {
  const params = new URLSearchParams({
    appids: appid,
    filter: "basic,controller_support",
    l: "english",
  });
  const res = await metadataHttp.fetch<
    Record<string, { data?: { controller_support?: string } }>
  >("Steam", `https://store.steampowered.com/api/appdetails?${params}`);
  const cs = res?.[appid]?.data?.controller_support;
  return cs === "full"
    ? ControllerSupport.Full
    : cs === "partial"
      ? ControllerSupport.Partial
      : ControllerSupport.None;
}

/**
 * POST /api/v1/admin/audit/backfill-metadata
 *
 * Backfills HowLongToBeat completion times and Steam controller-support onto
 * games ALREADY in the library, so existing games pick up the data without a
 * re-import. Runs as a background task because HLTB is rate-limited (expect a
 * few minutes for a large library). Idempotent: by default it only fills empty
 * fields; pass `overwrite: true` to refetch everything.
 *
 * Body: `{ hltb?: boolean = true, controller?: boolean = true, overwrite?: boolean = false }`
 */
export default defineEventHandler(async (h3) => {
  const allowed = await aclManager.allowSystemACL(h3, ["game:update"]);
  if (!allowed) throw createError({ statusCode: 403 });

  const body = (await readBody(h3).catch(() => ({}))) as {
    hltb?: boolean;
    controller?: boolean;
    overwrite?: boolean;
  };
  const doHltb = body.hltb !== false;
  const doController = body.controller !== false;
  const overwrite = body.overwrite === true;

  const taskId = await taskHandler.create({
    key: "backfill-metadata",
    taskGroup: "refresh:metadata",
    acls: ["system:maintenance:read"],
    name: "Backfill HLTB + controller metadata",
    async run({ progress, logger }) {
      progress(0);
      const games = await prisma.game.findMany({
        select: {
          id: true,
          mName: true,
          mReleased: true,
          metadataSource: true,
          metadataId: true,
          mHltbMain: true,
          mHltbMainSides: true,
          mHltbCompletionist: true,
          mControllerSupport: true,
        },
      });
      logger.info(
        `[backfill] ${games.length} games (hltb=${doHltb} controller=${doController} overwrite=${overwrite})`,
      );

      let hltbFilled = 0;
      let controllerFilled = 0;
      for (let i = 0; i < games.length; i++) {
        const g = games[i];
        const data: Prisma.GameUpdateManyMutationInput = {};

        const hasHltb =
          g.mHltbMain != null ||
          g.mHltbMainSides != null ||
          g.mHltbCompletionist != null;
        if (doHltb && (overwrite || !hasHltb)) {
          const year =
            g.mReleased && g.mReleased.getFullYear() > 1970
              ? g.mReleased.getFullYear()
              : undefined;
          const hltb = await fetchHltbTimes(g.mName, year).catch(() => null);
          if (hltb) {
            data.mHltbMain = hltb.main;
            data.mHltbMainSides = hltb.mainSides;
            data.mHltbCompletionist = hltb.completionist;
            hltbFilled++;
          }
        }

        if (
          doController &&
          g.metadataSource === MetadataSource.Steam &&
          (overwrite || g.mControllerSupport === ControllerSupport.None)
        ) {
          const cs = await fetchSteamControllerSupport(g.metadataId).catch(
            () => ControllerSupport.None,
          );
          if (cs !== ControllerSupport.None) {
            data.mControllerSupport = cs;
            controllerFilled++;
          }
        }

        if (Object.keys(data).length > 0) {
          await prisma.game.updateMany({ where: { id: g.id }, data });
        }

        progress(Math.round(((i + 1) / games.length) * 100));
        if ((i + 1) % 25 === 0) {
          logger.info(
            `[backfill] ${i + 1}/${games.length} (HLTB ${hltbFilled}, controller ${controllerFilled})`,
          );
        }
      }

      logger.info(
        `[backfill] done — ${games.length} games scanned, HLTB filled ${hltbFilled}, controller filled ${controllerFilled}`,
      );
    },
  });

  return { taskId };
});
