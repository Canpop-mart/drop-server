<template>
  <div class="space-y-6">
    <div class="sm:flex sm:items-center">
      <div class="sm:flex-auto">
        <h1 class="text-base font-semibold text-zinc-100">Library Audit</h1>
        <p class="mt-2 text-sm text-zinc-400">
          One report-only pass over the whole library, checked against what's on
          disk: orphaned versions, empty/unreadable folders, launch targets that
          are missing or aren't executables, versions with no Windows launch,
          and game folders on disk with no database row.
        </p>
      </div>
      <div class="mt-4 sm:mt-0 sm:flex-none flex gap-2">
        <button
          v-if="result"
          class="block rounded-md bg-zinc-800 px-3 py-2 text-center text-sm font-semibold text-zinc-100 shadow-sm transition-all hover:bg-zinc-700"
          @click="exportAudit"
        >
          Export
        </button>
        <button
          v-if="result && result.summary.orphanedVersions > 0"
          :disabled="purging || loading"
          class="block rounded-md bg-red-900/40 px-3 py-2 text-center text-sm font-semibold text-red-200 shadow-sm transition-all hover:bg-red-900/60 disabled:opacity-50"
          @click="purgeOrphans"
        >
          {{
            purging
              ? "Purging..."
              : `Purge ${result.summary.orphanedVersions} orphaned`
          }}
        </button>
        <button
          v-if="result && result.summary.mistaggedLinuxLaunches > 0"
          :disabled="fixing || loading"
          class="block rounded-md bg-sky-700/50 px-3 py-2 text-center text-sm font-semibold text-sky-100 shadow-sm transition-all hover:bg-sky-700/70 disabled:opacity-50"
          @click="fixMistagged"
        >
          {{
            fixing
              ? "Fixing..."
              : `Fix ${result.summary.mistaggedLinuxLaunches} mistagged`
          }}
        </button>
        <button
          v-if="result && result.summary.invalidTargets > 0"
          :disabled="redetecting || loading"
          class="block rounded-md bg-amber-700/40 px-3 py-2 text-center text-sm font-semibold text-amber-100 shadow-sm transition-all hover:bg-amber-700/60 disabled:opacity-50"
          @click="redetectBroken"
        >
          {{
            redetecting
              ? "Re-detecting..."
              : `Re-detect ${result.summary.invalidTargets} broken`
          }}
        </button>
        <button
          :disabled="backfilling || loading"
          class="block rounded-md bg-zinc-700/50 px-3 py-2 text-center text-sm font-semibold text-zinc-100 shadow-sm transition-all hover:bg-zinc-700 disabled:opacity-50"
          @click="backfillMetadata"
        >
          {{ backfilling ? "Starting..." : "Backfill HLTB + controller" }}
        </button>
        <button
          :disabled="loading"
          class="block rounded-md bg-blue-600 px-3 py-2 text-center text-sm font-semibold text-white shadow-sm transition-all hover:bg-blue-500 disabled:opacity-50"
          @click="() => runAudit()"
        >
          {{ loading ? "Scanning..." : "Re-run audit" }}
        </button>
      </div>
    </div>

    <div v-if="result" class="flex flex-wrap gap-2 text-xs">
      <span
        class="rounded bg-zinc-900 px-2 py-1 text-zinc-300 ring-1 ring-zinc-800"
      >
        {{ result.summary.versionsScanned }} versions scanned
      </span>
      <span
        class="rounded bg-red-500/10 px-2 py-1 text-red-400 ring-1 ring-red-500/30"
      >
        {{ result.summary.orphanedVersions }} orphaned
      </span>
      <span
        class="rounded bg-rose-500/10 px-2 py-1 text-rose-400 ring-1 ring-rose-500/30"
      >
        {{ result.summary.unreadableVersions }} unreadable
      </span>
      <span
        class="rounded bg-amber-500/10 px-2 py-1 text-amber-400 ring-1 ring-amber-500/30"
      >
        {{ result.summary.invalidTargets }} invalid target
      </span>
      <span
        class="rounded bg-sky-500/10 px-2 py-1 text-sky-400 ring-1 ring-sky-500/30"
      >
        {{ result.summary.mistaggedLinuxLaunches }} mistagged launch
      </span>
      <span
        class="rounded bg-orange-500/10 px-2 py-1 text-orange-400 ring-1 ring-orange-500/30"
      >
        {{ result.summary.missingTargets }} missing target
      </span>
      <span
        class="rounded bg-zinc-700/30 px-2 py-1 text-zinc-300 ring-1 ring-zinc-700"
      >
        {{ result.summary.missingWindowsLaunch }} no Windows launch
      </span>
      <span
        class="rounded bg-purple-500/10 px-2 py-1 text-purple-400 ring-1 ring-purple-500/30"
      >
        {{ result.summary.orphanedFolders }} orphaned folder
      </span>
    </div>

    <div
      v-if="result && result.issues.length === 0"
      class="text-sm text-green-400"
    >
      No issues found. Every version, launch config, and folder checks out.
    </div>

    <div
      v-else-if="result"
      class="overflow-hidden rounded-lg ring-1 ring-zinc-800"
    >
      <table class="min-w-full divide-y divide-zinc-800 text-sm">
        <thead class="bg-zinc-900 text-left text-xs uppercase text-zinc-500">
          <tr>
            <th class="px-3 py-2 font-medium">Game / Library</th>
            <th class="px-3 py-2 font-medium">Version</th>
            <th class="px-3 py-2 font-medium">Issue</th>
            <th class="px-3 py-2 font-medium">Platform</th>
            <th class="px-3 py-2 font-medium">Detail</th>
            <th class="px-3 py-2 font-medium"></th>
          </tr>
        </thead>
        <tbody class="divide-y divide-zinc-800 bg-zinc-950">
          <tr v-for="(issue, i) in result.issues" :key="i">
            <td class="px-3 py-2 text-zinc-200">
              {{ issue.gameName ?? issue.libraryName ?? "—" }}
            </td>
            <td class="px-3 py-2 text-zinc-400">
              {{ issue.versionName ?? "—" }}
            </td>
            <td class="px-3 py-2">
              <span :class="badgeClass(issue.type)">{{
                label(issue.type)
              }}</span>
            </td>
            <td class="px-3 py-2 text-zinc-400">{{ issue.platform ?? "—" }}</td>
            <td class="px-3 py-2 text-zinc-400">
              <span
                v-if="issue.command || issue.path"
                class="mono text-zinc-500"
                >{{ issue.command ?? issue.path }} </span
              ><span v-if="issue.command || issue.path">· </span
              >{{ issue.detail }}
            </td>
            <td class="px-3 py-2 whitespace-nowrap">
              <NuxtLink
                v-if="issue.gameId"
                :to="`/admin/library/${issue.gameId}`"
                class="text-blue-400 hover:underline"
              >
                Open editor
              </NuxtLink>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-else class="text-sm text-zinc-500">Loading audit...</div>
  </div>
</template>

<script setup lang="ts">
definePageMeta({
  layout: "admin",
});

interface AuditIssue {
  type: string;
  gameId?: string;
  gameName?: string;
  versionId?: string;
  versionName?: string;
  platform?: string;
  launchId?: string;
  launchName?: string;
  command?: string;
  libraryName?: string;
  path?: string;
  detail: string;
}

interface AuditResult {
  issues: AuditIssue[];
  summary: {
    versionsScanned: number;
    orphanedVersions: number;
    unreadableVersions: number;
    missingTargets: number;
    invalidTargets: number;
    missingWindowsLaunch: number;
    mistaggedLinuxLaunches: number;
    orphanedFolders: number;
  };
}

const result = ref<AuditResult | null>(null);
const loading = ref(false);
const purging = ref(false);
const fixing = ref(false);
const redetecting = ref(false);
const backfilling = ref(false);

// Re-derive launches for versions whose stored launch points at a
// non-executable (an older importer picked Unity/Unreal data files). Previews
// first so the counts can be confirmed; only ever touches already-broken
// versions, so it can't break a working launch.
async function redetectBroken() {
  if (!result.value || result.value.summary.invalidTargets === 0) return;
  redetecting.value = true;
  try {
    const preview = await $dropFetch<{
      total: number;
      willFix: number;
      noCandidate: number;
      skipped: number;
    }>("/api/v1/admin/audit/redetect-launches", {
      method: "POST",
      body: { apply: false },
    });
    if (preview.willFix === 0) {
      alert(
        `No re-detectable launches: of ${preview.total} broken, none had a usable executable in the stored file list (${preview.noCandidate} no candidate, ${preview.skipped} skipped).`,
      );
      return;
    }
    if (
      !confirm(
        `Re-detect found a real executable for ${preview.willFix} of ${preview.total} broken launches (${preview.noCandidate} had no candidate, ${preview.skipped} skipped). These versions are already broken, so this only repairs them. Apply ${preview.willFix}?`,
      )
    )
      return;
    await $dropFetch("/api/v1/admin/audit/redetect-launches", {
      method: "POST",
      body: { apply: true },
    });
    await runAudit();
  } finally {
    redetecting.value = false;
  }
}

// Backfill HLTB times + Steam controller support onto existing games, no
// re-import. Spawns a background task (a few minutes for a large library).
async function backfillMetadata() {
  if (
    !confirm(
      "Backfill HowLongToBeat times and Steam controller support for every existing game? It runs in the background (a few minutes for a large library) and only fills empty fields.",
    )
  )
    return;
  backfilling.value = true;
  try {
    await $dropFetch("/api/v1/admin/audit/backfill-metadata", {
      method: "POST",
      body: {},
    });
    alert(
      "Backfill started. Watch progress on the Tasks page; HLTB and controller data fill in on games as it runs.",
    );
  } finally {
    backfilling.value = false;
  }
}

// Re-tag Windows binaries tagged as Linux launches to Windows (or drop the
// redundant Linux entry when a Windows launch already exists). The server
// re-detects on call, so it only touches launches that are still mistagged.
async function fixMistagged() {
  if (!result.value) return;
  const n = result.value.summary.mistaggedLinuxLaunches;
  if (n === 0) return;
  if (
    !confirm(
      `Fix ${n} mistagged launch ${n === 1 ? "entry" : "entries"}? Windows .exe launches tagged as Linux will be re-tagged to Windows, or removed when a Windows launch already exists.`,
    )
  )
    return;
  fixing.value = true;
  try {
    await $dropFetch("/api/v1/admin/audit/fix-mistagged-launches", {
      method: "POST",
    });
    await runAudit();
  } finally {
    fixing.value = false;
  }
}

// Delete the orphaned-version rows (versions whose folder is gone on disk). The
// server re-detects at call time, so nothing whose folder reappeared is removed.
async function purgeOrphans() {
  if (!result.value) return;
  const n = result.value.summary.orphanedVersions;
  if (n === 0) return;
  if (
    !confirm(
      `Delete ${n} orphaned version ${n === 1 ? "row" : "rows"}? These are versions with no folder on disk. This removes the database entries only; nothing on disk is touched.`,
    )
  )
    return;
  purging.value = true;
  try {
    await $dropFetch("/api/v1/admin/audit/purge-orphaned-versions", {
      method: "POST",
    });
    await runAudit();
  } finally {
    purging.value = false;
  }
}

function exportAudit() {
  if (!result.value) return;
  const blob = new Blob([JSON.stringify(result.value, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `library-audit-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

async function runAudit() {
  loading.value = true;
  try {
    result.value = await $dropFetch<AuditResult>("/api/v1/admin/audit/library");
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  runAudit();
});

const LABELS: Record<string, string> = {
  orphaned_version: "Orphaned version",
  unreadable_version: "Unreadable",
  missing_launch_target: "Missing target",
  invalid_launch_target: "Invalid target",
  mistagged_linux_launch: "Mistagged launch",
  missing_windows_launch: "No Windows launch",
  orphaned_folder: "Orphaned folder",
};

function label(type: string) {
  return LABELS[type] ?? type;
}

function badgeClass(type: string) {
  const base = "inline-flex rounded px-2 py-0.5 text-xs font-medium ";
  if (type === "orphaned_version") return base + "bg-red-500/15 text-red-400";
  if (type === "unreadable_version")
    return base + "bg-rose-500/15 text-rose-400";
  if (type === "invalid_launch_target")
    return base + "bg-amber-500/15 text-amber-400";
  if (type === "mistagged_linux_launch")
    return base + "bg-sky-500/15 text-sky-400";
  if (type === "missing_launch_target")
    return base + "bg-orange-500/15 text-orange-400";
  if (type === "orphaned_folder")
    return base + "bg-purple-500/15 text-purple-400";
  return base + "bg-zinc-700/40 text-zinc-300";
}
</script>
