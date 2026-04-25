<template>
  <div class="space-y-6">
    <div>
      <h1 class="text-2xl font-semibold text-zinc-100">Compatibility</h1>
      <p class="mt-1 text-sm text-zinc-400">
        Per-platform test results across your library. Drives the badges on each
        game card and the test queue for the drop-client batch worker.
      </p>
    </div>

    <!-- Coverage rollup ─────────────────────────────────────────── -->
    <div class="grid grid-cols-1 gap-4 sm:grid-cols-3">
      <div class="rounded-xl bg-zinc-800/50 px-5 py-4 ring-1 ring-white/5">
        <div class="text-xs uppercase font-semibold text-zinc-500">
          Total games
        </div>
        <div class="mt-1 text-3xl font-bold text-zinc-100">
          {{ summary?.totalGames ?? "—" }}
        </div>
      </div>
      <div class="rounded-xl bg-zinc-800/50 px-5 py-4 ring-1 ring-white/5">
        <div class="text-xs uppercase font-semibold text-zinc-500">Tested</div>
        <div class="mt-1 text-3xl font-bold text-emerald-400">
          {{ summary?.testedGames ?? "—" }}
        </div>
      </div>
      <div class="rounded-xl bg-zinc-800/50 px-5 py-4 ring-1 ring-white/5">
        <div class="text-xs uppercase font-semibold text-zinc-500">
          Untested
        </div>
        <div class="mt-1 text-3xl font-bold text-amber-400">
          {{ summary?.untestedGames ?? "—" }}
        </div>
      </div>
    </div>

    <!-- Per-(platform, status) histogram ────────────────────────── -->
    <div class="rounded-xl bg-zinc-800/50 ring-1 ring-white/5 overflow-hidden">
      <div class="px-5 py-3 border-b border-zinc-700/40">
        <h2 class="text-sm font-semibold text-zinc-100">
          Latest result per (game, platform)
        </h2>
      </div>
      <table class="min-w-full text-sm">
        <thead class="bg-zinc-900/50 text-xs uppercase text-zinc-500">
          <tr>
            <th class="text-left px-5 py-2 font-semibold">Platform</th>
            <th class="text-left px-5 py-2 font-semibold">Status</th>
            <th class="text-right px-5 py-2 font-semibold">Games</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-zinc-700/30">
          <tr
            v-for="row in summary?.histogram ?? []"
            :key="`${row.platform}-${row.status}`"
            class="text-zinc-200"
          >
            <td class="px-5 py-2">{{ row.platform }}</td>
            <td class="px-5 py-2">
              <span
                :class="[
                  'inline-block px-2 py-0.5 rounded text-xs font-bold',
                  STATUS_COLOR[row.status] ?? 'bg-zinc-700 text-zinc-200',
                ]"
              >
                {{ STATUS_LABEL[row.status] ?? row.status }}
              </span>
            </td>
            <td class="px-5 py-2 text-right tabular-nums">{{ row.count }}</td>
          </tr>
          <tr v-if="!summary || summary.histogram.length === 0">
            <td colspan="3" class="px-5 py-6 text-center text-zinc-500 italic">
              No results yet — run a compatibility test from any client to
              populate this view.
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Crash-signature clusters ────────────────────────────────── -->
    <div class="rounded-xl bg-zinc-800/50 ring-1 ring-white/5 overflow-hidden">
      <div class="px-5 py-3 border-b border-zinc-700/40">
        <h2 class="text-sm font-semibold text-zinc-100">
          Top crash signatures
        </h2>
        <p class="mt-1 text-xs text-zinc-500">
          Failures that share a fingerprint usually share a root cause — fix one
          game in the cluster and the others may follow.
        </p>
      </div>
      <table class="min-w-full text-sm">
        <thead class="bg-zinc-900/50 text-xs uppercase text-zinc-500">
          <tr>
            <th class="text-left px-5 py-2 font-semibold">Status</th>
            <th class="text-left px-5 py-2 font-semibold">Signature</th>
            <th class="text-right px-5 py-2 font-semibold">Games affected</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-zinc-700/30">
          <tr
            v-for="(row, idx) in summary?.topSignatures ?? []"
            :key="idx"
            class="text-zinc-200"
          >
            <td class="px-5 py-2">
              <span
                :class="[
                  'inline-block px-2 py-0.5 rounded text-xs font-bold',
                  STATUS_COLOR[row.status] ?? 'bg-zinc-700 text-zinc-200',
                ]"
              >
                {{ STATUS_LABEL[row.status] ?? row.status }}
              </span>
            </td>
            <td class="px-5 py-2 font-mono text-xs text-zinc-300">
              {{ row.signature }}
            </td>
            <td class="px-5 py-2 text-right tabular-nums">
              {{ row.gameCount }}
            </td>
          </tr>
          <tr v-if="!summary || summary.topSignatures.length === 0">
            <td colspan="3" class="px-5 py-6 text-center text-zinc-500 italic">
              No crashes recorded — every test so far has either succeeded or
              produced a unique failure signature.
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<script setup lang="ts">
type CompatStatus = string;

type Summary = {
  totalGames: number;
  testedGames: number;
  untestedGames: number;
  histogram: Array<{
    platform: string;
    status: CompatStatus;
    count: number;
  }>;
  topSignatures: Array<{
    signature: string;
    status: CompatStatus;
    gameCount: number;
  }>;
};

// Colour + label maps mirror what CompatBadge uses, so the dashboard
// reads consistently with the per-card badges.
const STATUS_LABEL: Record<string, string> = {
  AliveRenders: "Plays correctly",
  AliveNoRender: "No render",
  EarlyExit: "Exits early",
  Crash: "Crashes",
  NoLaunch: "Won't launch",
  InstallFailed: "Install failed",
  Installing: "Installing",
  Testing: "Testing",
  Untested: "Untested",
};
const STATUS_COLOR: Record<string, string> = {
  AliveRenders: "bg-emerald-600 text-white",
  AliveNoRender: "bg-amber-500 text-zinc-900",
  EarlyExit: "bg-rose-600 text-white",
  Crash: "bg-rose-700 text-white",
  NoLaunch: "bg-zinc-700 text-zinc-300",
  InstallFailed: "bg-zinc-700 text-zinc-300",
  Installing: "bg-blue-600 text-white",
  Testing: "bg-blue-600 text-white",
  Untested: "bg-zinc-800 text-zinc-500",
};

definePageMeta({
  layout: "admin",
});

const { data: summary } = await useFetch<Summary>(
  "/api/v1/admin/compat/summary",
);

useHead({ title: "Compatibility — Admin" });
</script>
