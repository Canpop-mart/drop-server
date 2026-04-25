<template>
  <div
    v-if="entries.length > 0"
    class="flex items-center gap-0.5"
    :title="tooltipText"
  >
    <span
      v-for="entry in entries"
      :key="entry.platform"
      :class="[
        'text-[9px] font-bold leading-none px-1 py-0.5 rounded-md shadow-sm select-none',
        entry.colorClasses,
      ]"
    >
      {{ entry.label }}
    </span>
  </div>
</template>

<script setup lang="ts">
import type { GameCompatibilityStatus, Platform } from "~/prisma/client/enums";
import type { GameCompatSummary } from "~/composables/compatibility";

const { compat = undefined } = defineProps<{
  /**
   * Per-platform results for the game this badge represents. Pass the
   * value from `useCompatSummary()` keyed by gameId. Component renders
   * nothing when there's no data, so it's safe to always include in the
   * card and let it self-hide for untested games.
   */
  compat?: GameCompatSummary | undefined;
}>();

// Compact one-letter platform indicators — fits inside a 1.5-char-wide
// pill so multiple platforms can stack horizontally without crowding the
// genre tag / version badge already in the corner.
const PLATFORM_LABEL: Record<Platform, string> = {
  Windows: "W",
  Linux: "L",
  macOS: "M",
};

// Color choices: green = playable, amber = launches but visual issue,
// red/dark = doesn't run. Status enum naming mirrors the DB.
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

// Human-readable status names for the title tooltip.
const STATUS_LABEL: Record<GameCompatibilityStatus, string> = {
  AliveRenders: "Plays",
  AliveNoRender: "Launches but no render",
  EarlyExit: "Exits early",
  Crash: "Crashes",
  NoLaunch: "Won't launch",
  InstallFailed: "Install failed",
  Installing: "Installing…",
  Testing: "Testing…",
  Untested: "Untested",
};

const entries = computed(() => {
  if (!compat) return [];
  // Stable, deterministic platform order so the dot for "Windows" doesn't
  // jump around across re-renders.
  const order: Platform[] = ["Windows", "Linux", "macOS"];
  return order
    .filter((p) => compat[p])
    .map((p) => {
      const r = compat[p]!;
      return {
        platform: p,
        label: PLATFORM_LABEL[p],
        colorClasses: STATUS_COLOR[r.status],
        statusName: STATUS_LABEL[r.status],
        result: r,
      };
    });
});

const tooltipText = computed(() => {
  return entries.value
    .map((e) => {
      let line = `${e.platform}: ${e.statusName}`;
      if (e.result.protonVersion) line += ` (${e.result.protonVersion})`;
      if (e.result.signature) line += ` — ${e.result.signature}`;
      return line;
    })
    .join("\n");
});
</script>
