<template>
  <div class="space-y-6">
    <div class="sm:flex sm:items-center sm:justify-between">
      <div>
        <h1 class="text-2xl font-semibold text-zinc-100">
          {{ $t("bugReport.admin.title") }}
        </h1>
        <p class="mt-2 text-sm text-zinc-400">
          {{ $t("bugReport.admin.subtitle") }}
        </p>
      </div>
      <div class="mt-4 sm:mt-0 flex gap-2">
        <span
          class="inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium bg-red-500/10 text-red-400 ring-1 ring-red-500/20"
        >
          {{ openCount }} {{ $t("bugReport.admin.open") }}
        </span>
        <span
          class="inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium bg-yellow-500/10 text-yellow-400 ring-1 ring-yellow-500/20"
        >
          {{ inProgressCount }} {{ $t("bugReport.admin.inProgress") }}
        </span>
      </div>
    </div>

    <!-- Status filter -->
    <div class="flex gap-2">
      <button
        v-for="f in filters"
        :key="f.value"
        :class="[
          'px-3 py-1.5 rounded-md text-sm font-medium transition-colors',
          statusFilter === f.value
            ? 'bg-blue-600 text-white'
            : 'bg-zinc-800 text-zinc-400 hover:text-zinc-100',
        ]"
        @click="statusFilter = f.value"
      >
        {{ f.label }}
      </button>
    </div>

    <!-- Reports list -->
    <div v-if="loading" class="text-zinc-500 py-12 text-center">
      {{ $t("common.srLoading") }}
    </div>
    <div v-else-if="filteredReports.length === 0" class="py-12 text-center">
      <BugAntIcon class="mx-auto h-12 w-12 text-zinc-600" />
      <p class="mt-2 text-zinc-500">{{ $t("bugReport.admin.empty") }}</p>
    </div>
    <div v-else class="space-y-3">
      <div
        v-for="report in filteredReports"
        :key="report.id"
        class="p-4 rounded-xl bg-zinc-800 ring-1 ring-white/5 hover:ring-blue-500/20 transition-all cursor-pointer"
        @click="selectedReport = report"
      >
        <div class="flex items-start gap-4">
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-3">
              <h3 class="font-semibold text-zinc-100 truncate">
                {{ report.title }}
              </h3>
              <span
                :class="[
                  'shrink-0 inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
                  statusClasses[report.status],
                ]"
              >
                {{ statusLabels[report.status] }}
              </span>
            </div>
            <p
              v-if="report.description"
              class="text-sm text-zinc-400 mt-1 line-clamp-2"
            >
              {{ report.description }}
            </p>
            <div class="flex items-center gap-4 mt-2">
              <div class="flex items-center gap-1.5">
                <img
                  v-if="report.reporter?.profilePictureObjectId"
                  :src="useObject(report.reporter.profilePictureObjectId)"
                  class="size-4 rounded-full"
                />
                <span class="text-xs text-zinc-500">
                  {{
                    report.reporter?.displayName ||
                    report.reporter?.username ||
                    $t("user.unknown")
                  }}
                </span>
              </div>
              <RelativeTime
                :date="report.createdAt"
                class="text-xs text-zinc-600"
              />
              <span
                v-if="report.screenshotObjectId"
                class="text-xs text-zinc-600"
              >
                <PhotoIcon class="inline h-3.5 w-3.5 mr-0.5 -mt-0.5" />
                {{ $t("bugReport.admin.hasScreenshot") }}
              </span>
            </div>
          </div>
          <ChevronRightIcon class="h-5 w-5 text-zinc-600 shrink-0 mt-1" />
        </div>
      </div>
    </div>

    <!-- Detail modal -->
    <TransitionRoot as="template" :show="!!selectedReport">
      <Dialog class="relative z-50" @close="selectedReport = null">
        <TransitionChild
          as="template"
          enter="ease-out duration-200"
          enter-from="opacity-0"
          enter-to="opacity-100"
          leave="ease-in duration-150"
          leave-from="opacity-100"
          leave-to="opacity-0"
        >
          <div class="fixed inset-0 bg-zinc-950/80 backdrop-blur-sm" />
        </TransitionChild>
        <div class="fixed inset-0 z-10 overflow-y-auto">
          <div class="flex min-h-full items-center justify-center p-4">
            <TransitionChild
              as="template"
              enter="ease-out duration-200"
              enter-from="opacity-0 scale-95"
              enter-to="opacity-100 scale-100"
              leave="ease-in duration-150"
              leave-from="opacity-100 scale-100"
              leave-to="opacity-0 scale-95"
            >
              <DialogPanel
                v-if="selectedReport"
                class="w-full max-w-2xl rounded-xl bg-zinc-900 p-6 shadow-xl ring-1 ring-white/10"
              >
                <div class="flex items-start justify-between mb-4">
                  <div>
                    <DialogTitle
                      class="text-lg font-bold font-display text-zinc-100"
                    >
                      {{ selectedReport.title }}
                    </DialogTitle>
                    <div class="flex items-center gap-3 mt-1">
                      <span
                        :class="[
                          'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
                          statusClasses[selectedReport.status],
                        ]"
                      >
                        {{ statusLabels[selectedReport.status] }}
                      </span>
                      <span class="text-xs text-zinc-500">
                        {{ $t("bugReport.admin.reportedBy") }}
                        {{
                          selectedReport.reporter?.displayName ||
                          selectedReport.reporter?.username
                        }}
                      </span>
                      <RelativeTime
                        :date="selectedReport.createdAt"
                        class="text-xs text-zinc-600"
                      />
                    </div>
                  </div>
                </div>

                <!-- Description -->
                <div v-if="selectedReport.description" class="mb-4">
                  <h4 class="text-sm font-medium text-zinc-300 mb-1">
                    {{ $t("bugReport.form.description") }}
                  </h4>
                  <p class="text-sm text-zinc-400 whitespace-pre-wrap">
                    {{ selectedReport.description }}
                  </p>
                </div>

                <!-- Screenshot -->
                <div v-if="selectedReport.screenshotObjectId" class="mb-4">
                  <h4 class="text-sm font-medium text-zinc-300 mb-1">
                    {{ $t("bugReport.form.screenshot") }}
                  </h4>
                  <img
                    :src="useObject(selectedReport.screenshotObjectId)"
                    class="max-h-64 rounded-lg ring-1 ring-white/10"
                  />
                </div>

                <!-- System Info -->
                <div v-if="selectedReport.systemInfo" class="mb-4">
                  <h4 class="text-sm font-medium text-zinc-300 mb-1">
                    {{ $t("bugReport.admin.systemInfo") }}
                  </h4>
                  <div
                    class="bg-zinc-800 rounded-lg p-3 text-xs font-mono text-zinc-400 max-h-48 overflow-auto"
                  >
                    <div
                      v-for="(value, key) in selectedReport.systemInfo"
                      :key="String(key)"
                      class="flex gap-2"
                    >
                      <span class="text-zinc-500 shrink-0">{{ key }}:</span>
                      <span class="text-zinc-300">{{ value }}</span>
                    </div>
                  </div>
                </div>

                <!-- Logs -->
                <div v-if="selectedReport.logs" class="mb-4">
                  <h4 class="text-sm font-medium text-zinc-300 mb-1">
                    {{ $t("bugReport.admin.logs") }}
                  </h4>
                  <pre
                    class="bg-zinc-800 rounded-lg p-3 text-xs font-mono text-zinc-400 max-h-48 overflow-auto whitespace-pre-wrap"
                    >{{ selectedReport.logs }}</pre
                  >
                </div>

                <!-- Admin controls -->
                <div class="border-t border-zinc-800 pt-4 mt-4 space-y-3">
                  <div>
                    <label class="block text-sm font-medium text-zinc-300 mb-1">
                      {{ $t("bugReport.admin.status") }}
                    </label>
                    <select
                      v-model="editStatus"
                      class="w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-blue-500"
                    >
                      <option value="Open">Open</option>
                      <option value="InProgress">In Progress</option>
                      <option value="Resolved">Resolved</option>
                      <option value="Closed">Closed</option>
                    </select>
                  </div>
                  <div>
                    <label class="block text-sm font-medium text-zinc-300 mb-1">
                      {{ $t("bugReport.admin.notes") }}
                    </label>
                    <textarea
                      v-model="editNotes"
                      rows="3"
                      class="w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 outline-none focus:border-blue-500 resize-none"
                      :placeholder="$t('bugReport.admin.notesPlaceholder')"
                    />
                  </div>
                </div>

                <div class="flex justify-end gap-2 mt-4">
                  <button
                    class="px-4 py-2 rounded-md text-sm text-zinc-300 hover:text-zinc-100"
                    @click="selectedReport = null"
                  >
                    {{ $t("cancel") }}
                  </button>
                  <LoadingButton
                    :loading="updating"
                    class="px-4 py-2 rounded-md text-sm font-medium bg-blue-600 hover:bg-blue-500 text-white"
                    @click="updateReport"
                  >
                    {{ $t("bugReport.admin.update") }}
                  </LoadingButton>
                </div>
              </DialogPanel>
            </TransitionChild>
          </div>
        </div>
      </Dialog>
    </TransitionRoot>
  </div>
</template>

<script setup lang="ts">
import {
  Dialog,
  DialogPanel,
  DialogTitle,
  TransitionChild,
  TransitionRoot,
} from "@headlessui/vue";
import {
  BugAntIcon,
  ChevronRightIcon,
  PhotoIcon,
} from "@heroicons/vue/24/outline";
import { useObject } from "~/composables/objects";

definePageMeta({ layout: "admin" });

const { t } = useI18n();
useHead({ title: t("bugReport.admin.title") });

type BugReportItem = {
  id: string;
  title: string;
  description: string;
  systemInfo: Record<string, unknown> | null;
  screenshotObjectId: string | null;
  logs: string | null;
  status: "Open" | "InProgress" | "Resolved" | "Closed";
  adminNotes: string | null;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  reporter: {
    id: string;
    username: string;
    displayName: string;
    profilePictureObjectId: string;
  } | null;
  assignee: {
    id: string;
    username: string;
    displayName: string;
  } | null;
};

const statusLabels: Record<string, string> = {
  Open: t("bugReport.status.Open"),
  InProgress: t("bugReport.status.InProgress"),
  Resolved: t("bugReport.status.Resolved"),
  Closed: t("bugReport.status.Closed"),
};

const statusClasses: Record<string, string> = {
  Open: "bg-red-500/10 text-red-400 ring-1 ring-red-500/20",
  InProgress: "bg-yellow-500/10 text-yellow-400 ring-1 ring-yellow-500/20",
  Resolved: "bg-green-500/10 text-green-400 ring-1 ring-green-500/20",
  Closed: "bg-zinc-500/10 text-zinc-400 ring-1 ring-zinc-500/20",
};

const filters = [
  { value: "", label: t("bugReport.admin.filterAll") },
  { value: "Open", label: t("bugReport.status.Open") },
  { value: "InProgress", label: t("bugReport.status.InProgress") },
  { value: "Resolved", label: t("bugReport.status.Resolved") },
  { value: "Closed", label: t("bugReport.status.Closed") },
];

const loading = ref(false);
const statusFilter = ref("");
const reports = ref<BugReportItem[]>([]);

const filteredReports = computed(() => {
  if (!statusFilter.value) return reports.value;
  return reports.value.filter((r) => r.status === statusFilter.value);
});

const openCount = computed(
  () => reports.value.filter((r) => r.status === "Open").length,
);
const inProgressCount = computed(
  () => reports.value.filter((r) => r.status === "InProgress").length,
);

async function fetchReports() {
  loading.value = true;
  try {
    reports.value = (await $dropFetch(
      "/api/v1/admin/bugreports/list",
    )) as BugReportItem[];
  } catch {
    reports.value = [];
  } finally {
    loading.value = false;
  }
}

await fetchReports();

// Detail / edit
const selectedReport = ref<BugReportItem | null>(null);
const editStatus = ref("Open");
const editNotes = ref("");
const updating = ref(false);

watch(selectedReport, (r) => {
  if (r) {
    editStatus.value = r.status;
    editNotes.value = r.adminNotes || "";
  }
});

async function updateReport() {
  if (!selectedReport.value) return;
  updating.value = true;
  try {
    await $dropFetch("/api/v1/admin/bugreports/:id", {
      method: "PATCH",
      params: { id: selectedReport.value.id },
      body: {
        status: editStatus.value,
        adminNotes: editNotes.value,
      },
    });
    // Refresh
    await fetchReports();
    selectedReport.value = null;
  } finally {
    updating.value = false;
  }
}
</script>
