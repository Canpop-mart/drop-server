<template>
  <div class="space-y-6 text-zinc-100">
    <div>
      <h1 class="text-2xl font-semibold">Object Store</h1>
      <p class="mt-1 text-sm text-zinc-400">
        Storage stats and orphan detection for game art, profile media, news
        images, screenshots, and bug-report attachments.
      </p>
    </div>

    <!-- Stat tiles ──────────────────────────────────────────────── -->
    <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
      <div class="rounded-lg bg-zinc-800 border border-zinc-700 p-4">
        <div class="text-xs uppercase tracking-wide text-zinc-500">Objects</div>
        <div class="mt-1 text-2xl font-semibold">
          {{ data.count.toLocaleString() }}
        </div>
      </div>
      <div class="rounded-lg bg-zinc-800 border border-zinc-700 p-4">
        <div class="text-xs uppercase tracking-wide text-zinc-500">
          Total size
        </div>
        <div class="mt-1 text-2xl font-semibold">
          {{ formatBytes(data.totalSize) }}
        </div>
      </div>
      <div class="rounded-lg bg-zinc-800 border border-zinc-700 p-4">
        <div class="text-xs uppercase tracking-wide text-zinc-500">
          Last GC run
        </div>
        <div v-if="data.lastGc" class="mt-1 text-base">
          <span
            :class="
              data.lastGc.status === 'success'
                ? 'text-green-400'
                : data.lastGc.status === 'failed'
                  ? 'text-red-400'
                  : 'text-amber-400'
            "
          >
            {{ data.lastGc.status }}
          </span>
          <span class="text-zinc-500 ml-2 text-xs">
            {{ formatDate(data.lastGc.startedAt) }}
          </span>
        </div>
        <div v-else class="mt-1 text-base text-zinc-500">Never</div>
      </div>
    </div>

    <!-- Drift warning ──────────────────────────────────────────── -->
    <div
      v-if="data.drift.length > 0"
      class="rounded-lg border border-amber-700 bg-amber-900/30 p-4"
    >
      <div class="font-semibold text-amber-200">Schema drift detected</div>
      <p class="text-sm text-amber-100 mt-1">
        {{ data.drift.length }} Prisma column(s) hold object IDs but aren't
        registered in
        <code class="text-xs">server/internal/objects/objectRefs.ts</code>. GC
        will refuse to run until they're added; otherwise it would delete live
        objects.
      </p>
      <ul class="mt-2 text-xs text-amber-100 list-disc list-inside">
        <li v-for="d in data.drift" :key="`${d.model}.${d.field}`">
          {{ d.model }}.{{ d.field }}
        </li>
      </ul>
    </div>

    <!-- Actions ────────────────────────────────────────────────── -->
    <div class="flex gap-2 items-center">
      <button
        :disabled="gcStarting"
        class="rounded bg-blue-600 hover:bg-blue-500 disabled:opacity-50 px-3 py-1.5 text-sm font-medium"
        @click="forceGc"
      >
        {{ gcStarting ? "Starting…" : "Force GC run" }}
      </button>
      <NuxtLink
        v-if="latestGcTaskId"
        :href="`/admin/task/${latestGcTaskId}`"
        class="text-sm text-blue-300 hover:text-blue-100 underline"
      >
        View running task
      </NuxtLink>
      <button
        class="ml-auto rounded border border-zinc-700 px-3 py-1.5 text-sm hover:bg-zinc-800"
        @click="reload"
      >
        Refresh
      </button>
    </div>

    <!-- Top objects ────────────────────────────────────────────── -->
    <div>
      <h2 class="text-sm font-medium text-zinc-400">Top 20 largest objects</h2>
      <div
        class="mt-3 rounded-lg border border-zinc-700 bg-zinc-800 overflow-hidden"
      >
        <table class="min-w-full divide-y divide-zinc-700 text-sm">
          <thead class="bg-zinc-900/50">
            <tr>
              <th class="px-3 py-2 text-left font-medium text-zinc-400">ID</th>
              <th class="px-3 py-2 text-right font-medium text-zinc-400">
                Size
              </th>
              <th class="px-3 py-2 text-left font-medium text-zinc-400">
                Modified
              </th>
            </tr>
          </thead>
          <tbody class="divide-y divide-zinc-700/50">
            <tr v-for="o in data.top" :key="o.id" class="hover:bg-zinc-700/30">
              <td class="px-3 py-2 font-mono text-xs truncate max-w-md">
                <NuxtLink
                  :href="`/api/v1/object/${o.id}`"
                  target="_blank"
                  class="text-blue-300 hover:text-blue-100"
                >
                  {{ o.id }}
                </NuxtLink>
              </td>
              <td class="px-3 py-2 text-right">{{ formatBytes(o.size) }}</td>
              <td class="px-3 py-2 text-zinc-500 text-xs">
                {{ formatDate(o.mtime) }}
              </td>
            </tr>
            <tr v-if="data.top.length === 0">
              <td colspan="3" class="px-3 py-4 text-center text-zinc-500">
                No objects.
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- Registry ──────────────────────────────────────────────── -->
    <div>
      <h2 class="text-sm font-medium text-zinc-400">
        Tracked reference columns ({{ data.registry.length }})
      </h2>
      <p class="mt-1 text-xs text-zinc-500">
        Source of truth lives in
        <code>server/internal/objects/objectRefs.ts</code>. Add a new column to
        the registry whenever you add one to the schema.
      </p>
      <div
        class="mt-3 rounded-lg border border-zinc-700 bg-zinc-800 overflow-hidden"
      >
        <table class="min-w-full divide-y divide-zinc-700 text-sm">
          <thead class="bg-zinc-900/50">
            <tr>
              <th class="px-3 py-2 text-left font-medium text-zinc-400">
                Model
              </th>
              <th class="px-3 py-2 text-left font-medium text-zinc-400">
                Field
              </th>
              <th class="px-3 py-2 text-left font-medium text-zinc-400">
                Kind
              </th>
              <th class="px-3 py-2 text-left font-medium text-zinc-400">
                Label
              </th>
            </tr>
          </thead>
          <tbody class="divide-y divide-zinc-700/50">
            <tr v-for="c in data.registry" :key="`${c.model}.${c.field}`">
              <td class="px-3 py-2 font-mono text-xs">{{ c.model }}</td>
              <td class="px-3 py-2 font-mono text-xs">{{ c.field }}</td>
              <td class="px-3 py-2 text-xs text-zinc-400">{{ c.kind }}</td>
              <td class="px-3 py-2 text-xs text-zinc-400">{{ c.label }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { formatBytes } from "~/server/internal/utils/files";

definePageMeta({ layout: "admin" });
useHead({ title: "Objects" });

type ObjectStats = {
  count: number;
  totalSize: number;
  top: Array<{ id: string; size: number; mtime: string }>;
  registry: Array<{
    model: string;
    field: string;
    kind: "scalar" | "array";
    label: string;
  }>;
  drift: Array<{ model: string; field: string }>;
  lastGc: {
    id: string;
    status: string;
    startedAt: string;
    endedAt: string | null;
    progress: number;
    error: string | null;
  } | null;
};

const initial = (await $dropFetch("/api/v1/admin/objects")) as ObjectStats;
const data = ref<ObjectStats>(initial);

const gcStarting = ref(false);
const latestGcTaskId = ref<string | null>(null);

async function forceGc() {
  gcStarting.value = true;
  try {
    const res = await $dropFetch<{ taskId: string }>(
      "/api/v1/admin/objects/gc",
      { method: "POST" },
    );
    latestGcTaskId.value = res.taskId;
    // Stat counters won't change until the run finishes; the operator
    // can click Refresh once they've watched the run go.
  } finally {
    gcStarting.value = false;
  }
}

async function reload() {
  data.value = (await $dropFetch("/api/v1/admin/objects")) as ObjectStats;
}

function formatDate(iso: string | Date) {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  return d.toLocaleString();
}
</script>
