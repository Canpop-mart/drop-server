import aclManager from "~/server/internal/acls";
import prisma from "~/server/internal/db/database";
import { auditLibrary } from "~/server/internal/library/audit";
import { libraryManager } from "~/server/internal/library";

/**
 * POST /api/v1/admin/audit/redetect-launches
 *
 * Repairs versions whose stored launch points at a non-executable (the
 * `invalid_launch_target` findings, usually a Unity/Unreal data file picked by
 * an older importer). For each such version it re-derives the launch from the
 * version's stored fileList using the current detection, and — only when
 * `apply` is true — replaces that version's non-emulator launches with the
 * result. Emulator launches are left untouched.
 *
 * Body: `{ apply?: boolean }`. With `apply` false (default) it previews: nothing
 * is written, but the proposed changes and counts are returned so the caller
 * can confirm. Only ever touches versions that are already broken, so it can
 * never break a working launch.
 */
export default defineEventHandler(async (h3) => {
  const allowed = await aclManager.allowSystemACL(h3, ["game:version:update"]);
  if (!allowed) throw createError({ statusCode: 403 });

  const body = await readBody(h3).catch(() => ({}));
  const apply = (body as { apply?: boolean })?.apply === true;

  const audit = await auditLibrary();
  const versionIds = [
    ...new Set(
      audit.issues
        .filter((i) => i.type === "invalid_launch_target" && i.versionId)
        .map((i) => i.versionId as string),
    ),
  ];

  const proposals: Array<{
    gameId: string;
    gameName: string;
    versionName: string;
    current: string[];
    proposed: string[];
    status: "will-fix" | "no-candidate" | "skipped-referenced";
  }> = [];

  let willFix = 0;
  let noCandidate = 0;
  let skipped = 0;
  let applied = 0;

  if (versionIds.length === 0)
    return { total: 0, willFix, noCandidate, skipped, applied, proposals };

  const versions = await prisma.gameVersion.findMany({
    where: { versionId: { in: versionIds } },
    select: {
      versionId: true,
      displayName: true,
      versionPath: true,
      fileList: true,
      game: { select: { id: true, mName: true } },
      launches: {
        select: {
          platform: true,
          command: true,
          emulatorId: true,
          emulations: { select: { launchId: true } },
        },
      },
    },
  });

  for (const version of versions) {
    const versionName =
      version.displayName ?? version.versionPath ?? version.versionId;
    const nonEmulator = version.launches.filter((l) => !l.emulatorId);
    const current = nonEmulator.map((l) => `${l.platform}: ${l.command}`);
    const proposed = libraryManager.redetectLaunches(
      version.fileList,
      version.game.mName,
    );
    const proposedStr = proposed.map((l) => `${l.platform}: ${l.command}`);
    const entry = {
      gameId: version.game.id,
      gameName: version.game.mName,
      versionName,
      current,
      proposed: proposedStr,
    };

    if (proposed.length === 0) {
      noCandidate++;
      proposals.push({ ...entry, status: "no-candidate" });
      continue;
    }

    // Don't touch a version whose non-emulator launch is itself referenced as
    // an emulator by another game — that needs manual handling.
    if (nonEmulator.some((l) => l.emulations.length > 0)) {
      skipped++;
      proposals.push({ ...entry, status: "skipped-referenced" });
      continue;
    }

    willFix++;
    proposals.push({ ...entry, status: "will-fix" });

    if (apply) {
      await prisma.$transaction([
        prisma.launchConfiguration.deleteMany({
          where: { versionId: version.versionId, emulatorId: null },
        }),
        ...proposed.map((l) =>
          prisma.launchConfiguration.create({
            data: {
              versionId: version.versionId,
              platform: l.platform,
              name: l.name,
              command: l.command,
            },
          }),
        ),
      ]);
      applied++;
    }
  }

  return {
    total: versions.length,
    willFix,
    noCandidate,
    skipped,
    applied,
    proposals,
  };
});
