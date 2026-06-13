<template>
  <div>
    <div>
      <h2 class="text-sm font-medium text-zinc-400">
        {{ $t("tasks.admin.runningTasksTitle") }}
      </h2>
      <ul
        role="list"
        class="mt-4 grid grid-cols-1 gap-6 sm:grid-cols-3 lg:grid-cols-4"
      >
        <li
          v-for="task in liveRunningTasks"
          :key="task.value?.id"
          class="col-span-1 divide-y divide-gray-200 rounded-lg bg-zinc-800 border border-zinc-700 shadow-sm"
        >
          <TaskWidget :task="task.value" :active="true">
            <template #actions>
              <button
                v-if="task.value?.id"
                class="text-xs text-red-300 hover:text-red-100 underline"
                @click="cancelTask(task.value.id)"
              >
                Cancel
              </button>
            </template>
          </TaskWidget>
        </li>
      </ul>
      <div
        v-if="liveRunningTasks.length == 0"
        class="text-zinc-500 text-sm font-semibold"
      >
        {{ $t("tasks.admin.noTasksRunning") }}
      </div>
    </div>

    <!-- ─── Tabs: Recent / History ──────────────────────────────── -->
    <div class="mt-8 border-b border-zinc-800 flex gap-x-6 text-sm">
      <button
        :class="
          activeTab === 'recent'
            ? 'text-zinc-100 border-b-2 border-blue-500 pb-2'
            : 'text-zinc-500 hover:text-zinc-300 pb-2'
        "
        @click="activeTab = 'recent'"
      >
        Recent
      </button>
      <button
        :class="
          activeTab === 'history'
            ? 'text-zinc-100 border-b-2 border-blue-500 pb-2'
            : 'text-zinc-500 hover:text-zinc-300 pb-2'
        "
        @click="
          activeTab = 'history';
          loadReceipts();
        "
      >
        History
      </button>
      <button
        :class="
          activeTab === 'failed'
            ? 'text-zinc-100 border-b-2 border-blue-500 pb-2'
            : 'text-zinc-500 hover:text-zinc-300 pb-2'
        "
        @click="
          activeTab = 'failed';
          loadFailedReceipts();
        "
      >
        Failed (24h)
      </button>
    </div>

    <div class="mt-6 w-full grid lg:grid-cols-3 gap-8">
      <div class="col-span-2">
        <!-- ─── Recent tab ─────────────────────────────────────── -->
        <div v-if="activeTab === 'recent'">
          <h2 class="text-sm font-medium text-zinc-400">
            {{ $t("tasks.admin.completedTasksTitle") }}
          </h2>
          <ul
            role="list"
            class="mt-4 grid grid-cols-1 gap-2 lg:grid-cols-4 overflow-y-scroll max-h-[80vh]"
          >
            <li
              v-for="task in historicalTasks"
              :key="task.id"
              class="col-span-1 divide-y divide-gray-200 rounded-lg bg-zinc-800 border border-zinc-700 shadow-sm"
            >
              <div
                class="flex w-full items-center justify-between space-x-6 p-2"
              >
                <div class="flex-1 truncate">
                  <div class="flex items-center space-x-1">
                    <div>
                      <CheckCircleIcon
                        v-if="task.success"
                        class="size-5 text-green-600"
                      />
                      <XMarkIcon
                        v-else-if="task.error"
                        class="size-5 text-red-600"
                      />
                      <div
                        v-else
                        class="size-2 bg-blue-600 rounded-full animate-pulse m-1"
                      />
                    </div>
                    <h3 class="truncate text-sm font-medium text-zinc-100">
                      {{ task.name }}
                    </h3>
                  </div>
                  <ul v-if="task.actions" class="mt-1 flex flex-row gap-x-2">
                    <NuxtLink
                      v-for="[name, link] in task.actions.map((v) =>
                        v.split(':'),
                      )"
                      :key="link"
                      :href="link"
                      class="text-xs text-zinc-100 bg-blue-900 p-1 rounded"
                      >{{ name }}</NuxtLink
                    >
                  </ul>
                  <NuxtLink
                    type="button"
                    :href="`/admin/task/${task.id}`"
                    class="mt-3 ml-1 rounded-md text-xs font-medium text-zinc-100 hover:text-zinc-300 focus:outline-none focus:ring-2 focus:ring-zinc-100 focus:ring-offset-2"
                  >
                    <i18n-t
                      keypath="tasks.admin.viewTask"
                      tag="span"
                      scope="global"
                    >
                      <template #arrow>
                        <span aria-hidden="true">{{ $t("chars.arrow") }}</span>
                      </template>
                    </i18n-t>
                  </NuxtLink>
                </div>
              </div>
            </li>
          </ul>
        </div>

        <!-- ─── History tab ────────────────────────────────────── -->
        <div v-else>
          <div class="flex flex-wrap items-center gap-3 mb-4">
            <input
              v-model="historySearch"
              type="search"
              placeholder="Search by name…"
              class="bg-zinc-900 border border-zinc-700 rounded px-3 py-1 text-sm text-zinc-100 placeholder-zinc-500"
              @input="loadReceipts"
            />
            <select
              v-model="historyGroup"
              class="bg-zinc-900 border border-zinc-700 rounded px-3 py-1 text-sm text-zinc-100"
              @change="loadReceipts"
            >
              <option value="">All groups</option>
              <option v-for="g in availableGroups" :key="g" :value="g">
                {{ g }}
              </option>
            </select>
            <select
              v-if="activeTab === 'history'"
              v-model="historyStatus"
              class="bg-zinc-900 border border-zinc-700 rounded px-3 py-1 text-sm text-zinc-100"
              @change="loadReceipts"
            >
              <option value="">All statuses</option>
              <option value="success">Success</option>
              <option value="failed">Failed</option>
              <option value="cancelled">Cancelled</option>
              <option value="orphaned">Orphaned</option>
            </select>
            <span class="text-xs text-zinc-500">
              {{ receipts.length }} result(s)
            </span>
          </div>

          <ul
            role="list"
            class="grid grid-cols-1 gap-2 overflow-y-scroll max-h-[80vh]"
          >
            <li
              v-for="receipt in receipts"
              :key="receipt.id"
              class="rounded-lg bg-zinc-800 border border-zinc-700 shadow-sm p-3"
            >
              <div class="flex items-start justify-between gap-x-3">
                <div class="flex-1 min-w-0">
                  <div class="flex items-center gap-x-2">
                    <CheckCircleIcon
                      v-if="receipt.status === 'success'"
                      class="size-4 text-green-600 shrink-0"
                    />
                    <XMarkIcon
                      v-else-if="receipt.status === 'failed'"
                      class="size-4 text-red-600 shrink-0"
                    />
                    <NoSymbolIcon
                      v-else-if="receipt.status === 'cancelled'"
                      class="size-4 text-amber-500 shrink-0"
                    />
                    <ExclamationTriangleIcon
                      v-else-if="receipt.status === 'orphaned'"
                      class="size-4 text-orange-500 shrink-0"
                    />
                    <div
                      v-else
                      class="size-2 bg-blue-600 rounded-full animate-pulse shrink-0"
                    />
                    <h3 class="text-sm font-medium text-zinc-100 truncate">
                      {{ receipt.name }}
                    </h3>
                    <span class="text-[10px] text-zinc-500 shrink-0">
                      {{ receipt.taskGroup }}
                    </span>
                  </div>
                  <div class="text-xs text-zinc-500 mt-1">
                    {{ formatDate(receipt.startedAt) }}
                    <span v-if="receipt.endedAt">
                      &middot;
                      {{ duration(receipt.startedAt, receipt.endedAt) }}
                    </span>
                  </div>
                  <p
                    v-if="receipt.error"
                    class="text-xs text-red-300 mt-1 truncate"
                  >
                    {{ receipt.error }}
                  </p>
                </div>
                <div class="flex flex-col gap-1 shrink-0">
                  <NuxtLink
                    :href="`/admin/task/${receipt.id}`"
                    class="text-xs text-zinc-300 hover:text-zinc-100 underline"
                  >
                    Logs
                  </NuxtLink>
                  <button
                    v-if="receipt.retryable"
                    class="text-xs text-blue-300 hover:text-blue-100 underline"
                    @click="retryReceipt(receipt.id)"
                  >
                    Retry
                  </button>
                  <button
                    class="text-xs text-zinc-500 hover:text-red-400 underline"
                    @click="deleteReceipt(receipt.id)"
                  >
                    Delete
                  </button>
                </div>
              </div>
            </li>
          </ul>
          <div
            v-if="receipts.length === 0 && !receiptsLoading"
            class="text-zinc-500 text-sm mt-4"
          >
            No receipts match those filters.
          </div>
        </div>
      </div>

      <div>
        <template v-for="section in sections" :key="section.key">
          <h2
            class="text-sm font-medium text-zinc-400"
            :class="section.first ? '' : 'mt-8'"
          >
            {{ section.title }}
          </h2>
          <p v-if="section.blurb" class="mt-1 text-xs text-zinc-500">
            {{ section.blurb }}
          </p>
          <ul role="list" class="mt-4 grid grid-cols-1 lg:grid-cols-2 gap-6">
            <li
              v-for="task in section.tasks"
              :key="task"
              class="col-span-1 divide-y divide-gray-200 rounded-lg bg-zinc-800 border border-zinc-700 shadow-sm"
            >
              <div
                class="flex w-full items-center justify-between space-x-6 p-6"
              >
                <div class="flex-1">
                  <div class="flex items-center space-x-2">
                    <h3 class="text-sm font-medium text-zinc-100">
                      {{ scheduledTasks[task].name }}
                    </h3>
                  </div>
                  <p class="mt-1 text-sm text-zinc-400">
                    {{ scheduledTasks[task].description }}
                  </p>
                  <button
                    class="mt-3 rounded-md text-xs font-medium text-zinc-100 hover:text-zinc-300 focus:outline-none focus:ring-2 focus:ring-zinc-100 focus:ring-offset-2"
                    @click="() => startTask(task)"
                  >
                    <i18n-t
                      keypath="tasks.admin.execute"
                      tag="span"
                      scope="global"
                      class="inline-flex items-center gap-x-1"
                    >
                      <template #arrow>
                        <PlayIcon class="size-4" aria-hidden="true" />
                      </template>
                    </i18n-t>
                  </button>
                </div>
              </div>
            </li>
          </ul>
        </template>
      </div>
    </div>
  </div>
</template>
<script lang="ts" setup>
import { CheckCircleIcon, XMarkIcon } from "@heroicons/vue/24/solid";
import {
  PlayIcon,
  NoSymbolIcon,
  ExclamationTriangleIcon,
} from "@heroicons/vue/24/outline";
import type { TaskGroup } from "~/server/internal/tasks/group";

useHead({
  title: "Tasks",
});

definePageMeta({
  layout: "admin",
});

const { t } = useI18n();

const {
  runningTasks,
  historicalTasks,
  dailyTasks,
  weeklyTasks,
  library,
  achievements,
  system,
} = await $dropFetch("/api/v1/admin/task");

const liveRunningTasks = ref(
  await Promise.all(runningTasks.map((e) => useTask(e))),
);

// ─── History tab state ─────────────────────────────────────────
type Receipt = {
  id: string;
  taskGroup: string;
  name: string;
  status: string;
  startedAt: string;
  endedAt: string | null;
  error: string | null;
  progress: number;
  actions: string[];
  retryable: boolean;
};

const activeTab = ref<"recent" | "history" | "failed">("recent");
const receipts = ref<Receipt[]>([]);
const receiptsLoading = ref(false);
const historySearch = ref("");
const historyGroup = ref("");
const historyStatus = ref("");

const availableGroups = computed(() => [
  ...new Set([
    ...dailyTasks,
    ...weeklyTasks,
    ...library,
    ...achievements,
    ...system,
  ]),
]);

async function loadReceipts() {
  receiptsLoading.value = true;
  try {
    const q = new URLSearchParams();
    if (historySearch.value) q.set("search", historySearch.value);
    if (historyGroup.value) q.set("taskGroup", historyGroup.value);
    if (historyStatus.value) q.set("status", historyStatus.value);
    q.set("take", "100");
    receipts.value = (await $dropFetch(
      `/api/v1/admin/task/receipts?${q.toString()}`,
    )) as Receipt[];
  } finally {
    receiptsLoading.value = false;
  }
}

async function loadFailedReceipts() {
  receiptsLoading.value = true;
  try {
    const q = new URLSearchParams({
      status: "failed",
      sinceHours: "24",
      take: "100",
    });
    receipts.value = (await $dropFetch(
      `/api/v1/admin/task/receipts?${q.toString()}`,
    )) as Receipt[];
  } finally {
    receiptsLoading.value = false;
  }
}

async function retryReceipt(id: string) {
  await $dropFetch(`/api/v1/admin/task/${id}/retry`, { method: "POST" });
  // re-load both lists; the new run will surface in `runningTasks`
  // after a refresh (live updates flow over the websocket).
  await loadReceipts();
}

async function deleteReceipt(id: string) {
  if (!window.confirm("Delete this task receipt? This cannot be undone."))
    return;
  await $dropFetch(`/api/v1/admin/task/${id}`, { method: "DELETE" });
  receipts.value = receipts.value.filter((r) => r.id !== id);
}

async function cancelTask(id: string) {
  await $dropFetch(`/api/v1/admin/task/${id}/cancel`, { method: "POST" });
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString();
}

function duration(startIso: string, endIso: string) {
  const ms = new Date(endIso).getTime() - new Date(startIso).getTime();
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 3_600_000) return `${(ms / 60_000).toFixed(1)}m`;
  return `${(ms / 3_600_000).toFixed(1)}h`;
}

const scheduledTasks: {
  [key in TaskGroup]: { name: string; description: string };
} = {
  // Scheduled cleanup (automatic)
  "cleanup:auth-records": {
    name: "Prune Expired Records",
    description:
      "Deletes expired invitations and expired/orphaned login sessions in one pass. Runs automatically every day.",
  },
  "cleanup:objects": {
    name: t("tasks.admin.scheduled.cleanupObjectsName"),
    description: t("tasks.admin.scheduled.cleanupObjectsDescription"),
  },
  "check:update": {
    name: t("tasks.admin.scheduled.checkUpdateName"),
    description: t("tasks.admin.scheduled.checkUpdateDescription"),
  },

  // System-triggered, hidden from admin buttons
  "import:game": { name: "", description: "" },
  "import:version": { name: "", description: "" },

  // Library maintenance
  "check:game-updates": {
    name: "Check Game Updates",
    description:
      "Hits Steam for fresh build IDs and flips updateAvailable on any game that's behind. Also runs automatically every 6 hours.",
  },
  "scan:library-integrity": {
    name: "Audit Library",
    description:
      "One report-only pass over the whole library: orphaned versions, empty/unreadable folders, launch targets that are missing or aren't executables, versions with no Windows launch, and game folders on disk with no DB row. Runs weekly; full results on the Audit page.",
  },
  "refresh:metadata": {
    name: "Audit Metadata",
    description:
      "Lists games with missing descriptions, cover art, or suspicious release dates so you can re-link them.",
  },
  "regenerate:manifests": {
    name: "Regenerate Manifests",
    description:
      "Re-hashes every game's latest version and rewrites its droplet manifest. Run this after mass DLL swaps (or any on-disk change) so clients stop hitting checksum-invalid errors on download.",
  },

  // Achievements
  "scan:goldberg-readiness": {
    name: "Scan Goldberg Readiness",
    description:
      "Verifies steam_settings/, steam_appid.txt, achievements.json, and DB records for every Steam/Goldberg game. Auto-fixes gaps.",
  },
  "refresh:achievement-defs": {
    name: "Refresh Achievement Definitions",
    description:
      "Re-pulls achievement titles, descriptions, and icons from the Steam API for every linked game.",
  },
  "link:retroachievements": {
    name: "Auto-link RetroAchievements",
    description:
      "Searches RetroAchievements for every unlinked game and imports its achievement set when a match is found.",
  },
  "recalculate:achievements": {
    name: "Recalculate Achievements",
    description:
      "Audits per-user unlock counts and flags games whose definitions never fetched. Reports only.",
  },

  // System
  "recalculate:playtime": {
    name: "Recalculate Playtime",
    description:
      "Recomputes all cumulative playtime from session records. Fixes totals inflated by orphan double-counting.",
  },
  "backup:export": {
    name: "Export Backup",
    description:
      "Writes a JSON snapshot of games, users, versions, and achievements to /data/backups. Keeps the most recent 10.",
  },
  "cleanup:compat-logs": {
    name: "Tier Compatibility Logs",
    description:
      "Moves launch-telemetry log excerpts older than 7 days from the database into gzipped cold storage, and deletes cold files older than 30 days. The compact result rows are kept.",
  },
};

const sections = computed(() => [
  {
    key: "daily",
    title: t("tasks.admin.dailyScheduledTitle"),
    blurb: t("tasks.admin.dailyScheduledBlurb"),
    tasks: dailyTasks,
    first: true,
  },
  {
    key: "weekly",
    title: t("tasks.admin.weeklyScheduledTitle"),
    blurb: t("tasks.admin.weeklyScheduledBlurb"),
    tasks: weeklyTasks,
  },
  {
    key: "library",
    title: t("tasks.admin.libraryTitle"),
    blurb: t("tasks.admin.libraryBlurb"),
    tasks: library,
  },
  {
    key: "achievements",
    title: t("tasks.admin.achievementsTitle"),
    blurb: t("tasks.admin.achievementsBlurb"),
    tasks: achievements,
  },
  {
    key: "system",
    title: t("tasks.admin.systemTitle"),
    blurb: t("tasks.admin.systemBlurb"),
    tasks: system,
  },
]);

async function startTask(taskGroup: string) {
  const task = await $dropFetch("/api/v1/admin/task", {
    method: "POST",
    body: { taskGroup },
    failTitle: "Failed to start task",
  });
  const taskRef = await useTask(task.id);
  liveRunningTasks.value.push(taskRef);
}
</script>
