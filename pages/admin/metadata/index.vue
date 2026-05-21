<template>
  <div class="space-y-8 text-zinc-100">
    <div>
      <h1 class="text-2xl font-semibold">Metadata</h1>
      <p class="mt-1 text-sm text-zinc-400">
        Provider health, cache stats and a test-fetch form for the metadata
        scrape stack (Steam, IGDB, PCGamingWiki, GiantBomb).
      </p>
    </div>

    <!-- Sub-page links ─────────────────────────────────────────── -->
    <div class="flex flex-wrap gap-3">
      <NuxtLink
        to="/admin/metadata/tags"
        class="rounded-md border border-zinc-700 px-3 py-2 text-sm font-medium hover:bg-zinc-800"
      >
        {{ $t("library.admin.metadata.tags.title") }}
        <span aria-hidden="true">{{ $t("chars.arrow") }}</span>
      </NuxtLink>
      <NuxtLink
        to="/admin/metadata/companies"
        class="rounded-md border border-zinc-700 px-3 py-2 text-sm font-medium hover:bg-zinc-800"
      >
        {{ $t("library.admin.metadata.companies.title") }}
        <span aria-hidden="true">{{ $t("chars.arrow") }}</span>
      </NuxtLink>
    </div>

    <!-- Cache stats ────────────────────────────────────────────── -->
    <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
      <div class="rounded-lg bg-zinc-800 border border-zinc-700 p-4">
        <div class="text-xs uppercase tracking-wide text-zinc-500">
          Cache entries
        </div>
        <div class="mt-1 text-2xl font-semibold">
          {{ data.cache.entries.toLocaleString() }}
        </div>
      </div>
      <div class="rounded-lg bg-zinc-800 border border-zinc-700 p-4">
        <div class="text-xs uppercase tracking-wide text-zinc-500">
          Cache hit rate
        </div>
        <div class="mt-1 text-2xl font-semibold">
          {{ (data.cache.hitRate * 100).toFixed(1) }}%
        </div>
      </div>
      <div class="rounded-lg bg-zinc-800 border border-zinc-700 p-4">
        <div class="text-xs uppercase tracking-wide text-zinc-500">
          Cache hits
        </div>
        <div class="mt-1 text-2xl font-semibold">
          {{ data.cache.hits.toLocaleString() }}
        </div>
      </div>
      <div class="rounded-lg bg-zinc-800 border border-zinc-700 p-4">
        <div class="text-xs uppercase tracking-wide text-zinc-500">
          Cache misses
        </div>
        <div class="mt-1 text-2xl font-semibold">
          {{ data.cache.misses.toLocaleString() }}
        </div>
      </div>
    </div>

    <!-- Provider table ─────────────────────────────────────────── -->
    <div>
      <div class="flex items-center">
        <h2 class="text-sm font-medium text-zinc-400">
          Configured providers ({{ data.providers.length }})
        </h2>
        <button
          class="ml-auto rounded border border-zinc-700 px-3 py-1.5 text-sm hover:bg-zinc-800"
          @click="reload"
        >
          Refresh
        </button>
      </div>
      <div
        class="mt-3 rounded-lg border border-zinc-700 bg-zinc-800 overflow-hidden"
      >
        <table class="min-w-full divide-y divide-zinc-700 text-sm">
          <thead class="bg-zinc-900/50">
            <tr>
              <th class="px-3 py-2 text-left font-medium text-zinc-400">
                Provider
              </th>
              <th class="px-3 py-2 text-left font-medium text-zinc-400">
                Status
              </th>
              <th class="px-3 py-2 text-right font-medium text-zinc-400">
                Requests
              </th>
              <th class="px-3 py-2 text-right font-medium text-zinc-400">
                Failures
              </th>
              <th class="px-3 py-2 text-right font-medium text-zinc-400">
                Rate-limited
              </th>
              <th class="px-3 py-2 text-left font-medium text-zinc-400">
                Last error
              </th>
            </tr>
          </thead>
          <tbody class="divide-y divide-zinc-700/50">
            <tr
              v-for="p in data.providers"
              :key="p.source"
              class="hover:bg-zinc-700/30"
            >
              <td class="px-3 py-2 font-medium">{{ p.name }}</td>
              <td class="px-3 py-2">
                <span
                  :class="[
                    'rounded px-2 py-0.5 text-xs font-semibold',
                    statusClass(p.status),
                  ]"
                >
                  {{ p.status }}
                </span>
              </td>
              <td class="px-3 py-2 text-right">
                {{ p.stats.requests.toLocaleString() }}
              </td>
              <td
                class="px-3 py-2 text-right"
                :class="p.stats.failures > 0 ? 'text-red-400' : ''"
              >
                {{ p.stats.failures.toLocaleString() }}
              </td>
              <td
                class="px-3 py-2 text-right"
                :class="p.stats.rateLimited > 0 ? 'text-amber-400' : ''"
              >
                {{ p.stats.rateLimited.toLocaleString() }}
              </td>
              <td class="px-3 py-2 text-xs text-zinc-500 max-w-md truncate">
                {{ p.stats.lastError ?? "—" }}
              </td>
            </tr>
            <tr v-if="data.providers.length === 0">
              <td colspan="6" class="px-3 py-4 text-center text-zinc-500">
                No providers configured. Check provider API key env vars.
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- Test fetch ─────────────────────────────────────────────── -->
    <div>
      <h2 class="text-sm font-medium text-zinc-400">Test fetch</h2>
      <p class="mt-1 text-xs text-zinc-500">
        Runs a search across every provider — confirms connectivity and auth
        without importing a game.
      </p>
      <form class="mt-3 flex gap-2" @submit.prevent="runTestFetch">
        <input
          v-model="testQuery"
          type="text"
          placeholder="Game name, e.g. Portal 2"
          class="flex-1 rounded border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-sm focus:outline-none focus:border-blue-500"
        />
        <button
          type="submit"
          :disabled="testRunning || !testQuery.trim()"
          class="rounded bg-blue-600 hover:bg-blue-500 disabled:opacity-50 px-3 py-1.5 text-sm font-medium"
        >
          {{ testRunning ? "Searching…" : "Test fetch" }}
        </button>
      </form>

      <div
        v-if="testError"
        class="mt-3 rounded border border-red-700 bg-red-900/30 p-3 text-sm text-red-200"
      >
        {{ testError }}
      </div>

      <div
        v-if="testResult"
        class="mt-3 rounded-lg border border-zinc-700 bg-zinc-800 p-4"
      >
        <div class="text-sm text-zinc-300">
          <span class="font-semibold">{{ testResult.totalResults }}</span>
          result(s) for "{{ testResult.query }}" in
          {{ testResult.elapsedMs }}ms
        </div>
        <div class="mt-2 flex flex-wrap gap-2">
          <span
            v-for="(count, source) in testResult.bySource"
            :key="source"
            class="rounded bg-zinc-700 px-2 py-0.5 text-xs"
          >
            {{ source }}: {{ count }}
          </span>
        </div>
        <ul class="mt-3 space-y-1 text-xs text-zinc-400">
          <li v-for="r in testResult.results" :key="`${r.sourceId}-${r.id}`">
            <span class="text-zinc-200">{{ r.name }}</span>
            <span class="text-zinc-500">
              · {{ r.sourceName }} · id {{ r.id }}
              <template v-if="r.year">· {{ r.year }}</template>
            </span>
          </li>
        </ul>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
definePageMeta({ layout: "admin" });
useHead({ title: "Metadata" });

type ProviderHealth = {
  source: string;
  name: string;
  status: "up" | "down" | "unauthenticated" | "rate-limited";
  stats: {
    requests: number;
    failures: number;
    rateLimited: number;
    lastError: string | null;
    lastErrorAt: string | null;
    lastSuccessAt: string | null;
  };
};

type HealthPayload = {
  providers: ProviderHealth[];
  cache: {
    entries: number;
    hits: number;
    misses: number;
    hitRate: number;
  };
};

type TestFetchResult = {
  query: string;
  elapsedMs: number;
  totalResults: number;
  bySource: Record<string, number>;
  results: Array<{
    id: string;
    name: string;
    year: number;
    sourceId: string;
    sourceName: string;
  }>;
};

const initial = (await $dropFetch(
  "/api/v1/admin/metadata/health",
)) as HealthPayload;
const data = ref<HealthPayload>(initial);

async function reload() {
  data.value = (await $dropFetch(
    "/api/v1/admin/metadata/health",
  )) as HealthPayload;
}

function statusClass(status: ProviderHealth["status"]): string {
  switch (status) {
    case "up":
      return "bg-green-900 text-green-300";
    case "down":
      return "bg-red-900 text-red-300";
    case "unauthenticated":
      return "bg-amber-900 text-amber-300";
    case "rate-limited":
      return "bg-orange-900 text-orange-300";
    default:
      return "bg-zinc-700 text-zinc-300";
  }
}

const testQuery = ref("");
const testRunning = ref(false);
const testError = ref<string | null>(null);
const testResult = ref<TestFetchResult | null>(null);

async function runTestFetch() {
  if (!testQuery.value.trim()) return;
  testRunning.value = true;
  testError.value = null;
  testResult.value = null;
  try {
    testResult.value = (await $dropFetch("/api/v1/admin/metadata/test-fetch", {
      method: "POST",
      body: { query: testQuery.value.trim() },
    })) as TestFetchResult;
  } catch (e) {
    testError.value =
      e instanceof Error ? e.message : "Test fetch failed — see server logs.";
  } finally {
    testRunning.value = false;
  }
}
</script>
