<template>
  <div class="space-y-6">
    <div class="sm:flex sm:items-center">
      <div class="sm:flex-auto">
        <h1 class="text-base font-semibold text-zinc-100">
          Launch Config Audit
        </h1>
        <p class="mt-2 text-sm text-zinc-400">
          Every version's launch configs checked against what's on disk —
          orphaned versions, launch targets that are missing or aren't
          executables, and versions with no Windows launch.
        </p>
      </div>
      <div class="mt-4 sm:mt-0 sm:flex-none">
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
        class="rounded bg-amber-500/10 px-2 py-1 text-amber-400 ring-1 ring-amber-500/30"
      >
        {{ result.summary.invalidTargets }} invalid target
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
    </div>

    <div
      v-if="result && result.issues.length === 0"
      class="text-sm text-green-400"
    >
      No issues found — every version + launch config checks out.
    </div>

    <div
      v-else-if="result"
      class="overflow-hidden rounded-lg ring-1 ring-zinc-800"
    >
      <table class="min-w-full divide-y divide-zinc-800 text-sm">
        <thead class="bg-zinc-900 text-left text-xs uppercase text-zinc-500">
          <tr>
            <th class="px-3 py-2 font-medium">Game</th>
            <th class="px-3 py-2 font-medium">Version</th>
            <th class="px-3 py-2 font-medium">Issue</th>
            <th class="px-3 py-2 font-medium">Platform</th>
            <th class="px-3 py-2 font-medium">Detail</th>
            <th class="px-3 py-2 font-medium"></th>
          </tr>
        </thead>
        <tbody class="divide-y divide-zinc-800 bg-zinc-950">
          <tr v-for="(issue, i) in result.issues" :key="i">
            <td class="px-3 py-2 text-zinc-200">{{ issue.gameName }}</td>
            <td class="px-3 py-2 text-zinc-400">{{ issue.versionName }}</td>
            <td class="px-3 py-2">
              <span :class="badgeClass(issue.type)">{{
                label(issue.type)
              }}</span>
            </td>
            <td class="px-3 py-2 text-zinc-400">{{ issue.platform ?? "—" }}</td>
            <td class="px-3 py-2 text-zinc-400">
              <span v-if="issue.command" class="mono text-zinc-500">{{
                issue.command
              }}</span>
              <span v-if="issue.command"> — </span>{{ issue.detail }}
            </td>
            <td class="px-3 py-2 whitespace-nowrap">
              <NuxtLink
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
  gameId: string;
  gameName: string;
  versionId: string;
  versionName: string;
  platform?: string;
  launchId?: string;
  launchName?: string;
  command?: string;
  detail: string;
}

interface AuditResult {
  issues: AuditIssue[];
  summary: {
    versionsScanned: number;
    orphanedVersions: number;
    missingTargets: number;
    invalidTargets: number;
    missingWindowsLaunch: number;
  };
}

const result = ref<AuditResult | null>(null);
const loading = ref(false);

async function runAudit() {
  loading.value = true;
  try {
    result.value = await $dropFetch<AuditResult>(
      "/api/v1/admin/audit/launch-configs",
    );
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  runAudit();
});

const LABELS: Record<string, string> = {
  orphaned_version: "Orphaned version",
  missing_launch_target: "Missing target",
  invalid_launch_target: "Invalid target",
  missing_windows_launch: "No Windows launch",
};

function label(type: string) {
  return LABELS[type] ?? type;
}

function badgeClass(type: string) {
  const base = "inline-flex rounded px-2 py-0.5 text-xs font-medium ";
  if (type === "orphaned_version") return base + "bg-red-500/15 text-red-400";
  if (type === "invalid_launch_target")
    return base + "bg-amber-500/15 text-amber-400";
  if (type === "missing_launch_target")
    return base + "bg-orange-500/15 text-orange-400";
  return base + "bg-zinc-700/40 text-zinc-300";
}
</script>
