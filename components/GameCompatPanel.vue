<template>
  <div
    v-if="hasResults"
    class="bg-zinc-800/50 rounded-xl backdrop-blur-sm overflow-hidden"
  >
    <button
      class="w-full flex items-center justify-between p-6 text-left hover:bg-zinc-700/30 transition-colors"
      @click="open = !open"
    >
      <h2 class="text-xl font-display font-semibold text-zinc-100">
        Compatibility
      </h2>
      <ChevronDownIcon
        class="size-5 text-zinc-400 transition-transform duration-200"
        :class="{ 'rotate-180': open }"
      />
    </button>
    <Transition
      enter-active-class="transition-all duration-300 ease-out"
      enter-from-class="max-h-0 opacity-0"
      enter-to-class="max-h-[600px] opacity-100"
      leave-active-class="transition-all duration-200 ease-in"
      leave-from-class="max-h-[600px] opacity-100"
      leave-to-class="max-h-0 opacity-0"
    >
      <div v-show="open" class="overflow-hidden">
        <div class="px-6 pb-6 space-y-3">
          <p class="text-xs text-zinc-500">
            Test results from your devices. The latest result per platform wins.
          </p>
          <div
            v-for="row in rows"
            :key="row.platform"
            class="flex items-start gap-3 text-sm"
          >
            <span
              :class="[
                'shrink-0 px-2 py-0.5 rounded-md text-xs font-bold leading-tight',
                row.colorClasses,
              ]"
            >
              {{ row.platform }}
            </span>
            <div class="flex-1 min-w-0">
              <div class="text-zinc-100 font-medium">{{ row.label }}</div>
              <div
                v-if="row.signature"
                class="text-zinc-500 text-xs truncate font-mono"
              >
                {{ row.signature }}
              </div>
              <div class="text-zinc-600 text-[10px] mt-0.5">
                <span v-if="row.protonVersion">{{ row.protonVersion }} • </span>
                {{ formatTime(row.testedAt) }}
              </div>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { ChevronDownIcon } from "@heroicons/vue/20/solid";
import type { GameCompatibilityStatus, Platform } from "~/prisma/client/enums";
import type { GameCompatSummary } from "~/composables/compatibility";

const { compat = undefined } = defineProps<{
  /**
   * Compat summary for this game. Pass `useCompatSummary().value[gameId]`
   * from the parent. Component renders nothing if there's no data.
   */
  compat?: GameCompatSummary | undefined;
}>();

const open = ref(true);

const STATUS_LABEL: Record<GameCompatibilityStatus, string> = {
  AliveRenders: "Plays correctly",
  AliveNoRender: "Launches but doesn't render",
  EarlyExit: "Exits before main menu",
  Crash: "Crashes on launch",
  NoLaunch: "Doesn't launch",
  InstallFailed: "Install failed",
  Installing: "Install in progress",
  Testing: "Test in progress",
  Untested: "Not tested yet",
};

const STATUS_COLOR: Record<GameCompatibilityStatus, string> = {
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

const ORDER: Platform[] = ["Windows", "Linux", "macOS"];

const rows = computed(() => {
  if (!compat) return [];
  return ORDER.filter((p) => compat[p]).map((p) => {
    const r = compat[p]!;
    return {
      platform: p,
      label: STATUS_LABEL[r.status],
      colorClasses: STATUS_COLOR[r.status],
      signature: r.signature,
      protonVersion: r.protonVersion,
      testedAt: r.testedAt,
    };
  });
});

const hasResults = computed(() => rows.value.length > 0);

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString();
}
</script>
