<template>
  <div class="flex flex-col gap-2">
    <div
      v-if="achievement"
      class="flex items-center gap-3 p-3 rounded-lg transition-colors"
      :class="
        unlockedAt
          ? 'bg-zinc-800/50 hover:bg-zinc-700/50'
          : 'bg-zinc-800/30 opacity-60 hover:opacity-80'
      "
    >
      <img
        v-if="iconSrc && !iconErrored"
        :src="iconSrc"
        class="size-10 rounded shrink-0"
        :class="{ grayscale: !unlockedAt }"
        @error="iconErrored = true"
      />
      <div
        v-else
        class="size-10 rounded shrink-0 bg-zinc-700/50 flex items-center justify-center"
        :class="{ grayscale: !unlockedAt, 'opacity-50': !unlockedAt }"
      >
        <TrophyIcon class="size-5 text-zinc-500" />
      </div>
      <div class="flex-1 min-w-0">
        <p class="text-sm font-medium text-zinc-100 truncate">
          {{ achievement.title }}
        </p>
        <p class="text-xs text-zinc-400 line-clamp-1">
          {{ achievement.description }}
        </p>
        <!-- Rarity bar -->
        <div v-if="rarity !== undefined" class="flex items-center gap-2 mt-1">
          <div class="flex-1 h-1 bg-zinc-700 rounded-full overflow-hidden">
            <div
              class="h-full rounded-full transition-all duration-500"
              :class="rarityBarColor"
              :style="{ width: `${Math.max(rarity, 1)}%` }"
            />
          </div>
          <span
            class="text-[10px] font-medium shrink-0"
            :class="rarityTextColor"
          >
            {{ $t("achievements.rarity", { value: rarity }) }}
          </span>
        </div>
      </div>
      <div v-if="unlockedAt" class="text-xs text-green-400 shrink-0">
        {{ formatDate(unlockedAt) }}
      </div>
      <div v-else class="text-xs text-zinc-600 shrink-0">
        {{ $t("achievements.locked") }}
      </div>
    </div>
  </div>
</template>
<script setup lang="ts">
import { TrophyIcon } from "@heroicons/vue/24/solid";

const props = defineProps<{
  achievement: {
    id: string;
    title: string;
    description: string;
    iconUrl: string;
    iconLockedUrl: string;
  };
  unlockedAt?: Date | string | null;
  rarity?: number;
}>();

const formatDate = (d: Date | string) => new Date(d).toLocaleDateString();

// Track whether the image URL failed to load — if so, show trophy fallback
const iconErrored = ref(false);
watch(
  () => props.achievement.id,
  () => {
    iconErrored.value = false;
  },
);

// Pick the best icon URL — prefer unlocked icon when unlocked, locked icon when locked
const iconSrc = computed(() => {
  const primary = props.unlockedAt
    ? props.achievement.iconUrl || props.achievement.iconLockedUrl
    : props.achievement.iconLockedUrl || props.achievement.iconUrl;
  return primary || null; // Return null (not empty string) so v-if hides the img
});

// Color by rarity tier
const rarityBarColor = computed(() => {
  if (props.rarity === undefined) return "bg-zinc-500";
  if (props.rarity <= 5) return "bg-yellow-400";
  if (props.rarity <= 15) return "bg-purple-400";
  if (props.rarity <= 30) return "bg-blue-400";
  if (props.rarity <= 50) return "bg-green-400";
  return "bg-zinc-400";
});

const rarityTextColor = computed(() => {
  if (props.rarity === undefined) return "text-zinc-500";
  if (props.rarity <= 5) return "text-yellow-400";
  if (props.rarity <= 15) return "text-purple-400";
  if (props.rarity <= 30) return "text-blue-400";
  if (props.rarity <= 50) return "text-green-400";
  return "text-zinc-400";
});
</script>
