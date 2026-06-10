import { defineDropTask } from "..";
import { auditLibrary, type LibraryAuditIssue } from "../../library/audit";

/**
 * One report-only pass over the whole library — consolidates the old
 * scan:library-health, cleanup:library-orphans, and scan:launch-config-audit
 * tasks into a single disk walk. Surfaces orphaned versions (DB row, no
 * folder), empty/unreadable version folders (stale mount / ACL drift), launch
 * targets that are missing or aren't executables (the Linux data-file bug),
 * non-setup versions with no Windows launch, and game folders on disk with no
 * DB row. Never mutates.
 *
 * Bucketed into the weekly scheduler as the library canary; the full
 * structured results are on the admin Audit page
 * (GET /api/v1/admin/audit/library).
 */
export default defineDropTask({
  buildId: () => `scan:library-integrity:${new Date().toISOString()}`,
  name: "Audit Library",
  acls: ["system:maintenance:read"],
  taskGroup: "scan:library-integrity",

  async run({ progress, logger }) {
    logger.info(
      "Auditing library integrity (versions, files, launches, orphans)...",
    );
    const { issues, summary } = await auditLibrary();
    progress(90);

    if (issues.length === 0) {
      logger.info(
        `No issues across ${summary.versionsScanned} version(s). Library is clean.`,
      );
      progress(100);
      return;
    }

    // Group version-scoped issues by game; list orphaned folders separately.
    const byGame = new Map<string, LibraryAuditIssue[]>();
    const orphanFolders: LibraryAuditIssue[] = [];
    for (const issue of issues) {
      if (issue.type === "orphaned_folder") {
        orphanFolders.push(issue);
        continue;
      }
      const key = issue.gameName ?? "(unknown)";
      const list = byGame.get(key) ?? [];
      list.push(issue);
      byGame.set(key, list);
    }

    for (const [gameName, list] of byGame) {
      logger.info(`── ${gameName} ──`);
      for (const issue of list) {
        const plat = issue.platform ? ` [${issue.platform}]` : "";
        logger.info(
          `  [${issue.type}]${plat} ${issue.versionName}: ${issue.detail}`,
        );
      }
    }

    if (orphanFolders.length > 0) {
      logger.info("── Orphaned folders on disk ──");
      for (const issue of orphanFolders) {
        logger.info(`  ${issue.path} (${issue.libraryName})`);
      }
    }

    logger.info(
      `Audit complete — ${summary.versionsScanned} version(s) scanned, ` +
        `${issues.length} issue(s): ${summary.orphanedVersions} orphaned, ` +
        `${summary.unreadableVersions} unreadable, ${summary.invalidTargets} invalid, ` +
        `${summary.missingTargets} missing, ${summary.missingWindowsLaunch} missing-Windows, ` +
        `${summary.orphanedFolders} orphaned-folder. No changes made.`,
    );
    progress(100);
  },
});
