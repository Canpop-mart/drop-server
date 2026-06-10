import { defineDropTask } from "..";
import { auditLaunchConfigs, type LaunchAuditIssue } from "../../library/audit";

/**
 * Audits every GameVersion's launch configs + folder integrity against disk:
 * orphaned versions (DB row, no folder), launch targets that are missing or
 * aren't executables (the Linux "data file as launch" bug), and non-setup
 * versions with no Windows launch. Report-only — never mutates. Mirrors
 * `cleanup:library-orphans` / `scan:library-health`.
 */
export default defineDropTask({
  buildId: () => `scan:launch-config-audit:${new Date().toISOString()}`,
  name: "Audit Launch Configs & Versions",
  acls: ["system:maintenance:read"],
  taskGroup: "scan:launch-config-audit",

  async run({ progress, logger }) {
    logger.info("Auditing launch configs + version integrity...");
    const { issues, summary } = await auditLaunchConfigs();
    progress(90);

    if (issues.length === 0) {
      logger.info(`No issues across ${summary.versionsScanned} version(s).`);
      progress(100);
      return;
    }

    const byGame = new Map<string, LaunchAuditIssue[]>();
    for (const issue of issues) {
      const list = byGame.get(issue.gameName) ?? [];
      list.push(issue);
      byGame.set(issue.gameName, list);
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

    logger.info(
      `Audit complete — ${summary.versionsScanned} version(s) scanned, ` +
        `${issues.length} issue(s): ${summary.orphanedVersions} orphaned, ` +
        `${summary.invalidTargets} invalid, ${summary.missingTargets} missing, ` +
        `${summary.missingWindowsLaunch} missing-Windows. No changes made.`,
    );
    progress(100);
  },
});
