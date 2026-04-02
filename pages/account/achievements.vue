<template>
  <div class="max-w-4xl mx-auto">
    <div class="flex items-center justify-between mb-6">
      <div>
        <h1 class="text-2xl font-bold font-display text-zinc-100">
          {{ $t("account.achievements.title") }}
        </h1>
        <p class="text-sm text-zinc-400 mt-1">
          {{
            $t("account.achievements.subtitle", {
              count: allAchievements.length,
            })
          }}
        </p>
      </div>
      <button
        class="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-md transition-colors"
        :disabled="syncing"
        @click="syncAchievements"
      >
        {{ syncing ? $t("common.srLoading") : $t("account.achievements.sync") }}
      </button>
    </div>

    <!-- Filter by game -->
    <div class="flex gap-2 flex-wrap mb-6">
      <button
        :class="[
          'px-3 py-1 rounded-full text-xs font-medium transition-colors',
          !selectedGameId
            ? 'bg-blue-600 text-white'
            : 'bg-zinc-800 text-zinc-400 hover:text-zinc-100',
        ]"
        @click="selectedGameId = ''"
      >
        {{ $t("account.achievements.allGames") }}
      </button>
      <button
        v-for="g in gamesWithAchievements"
        :key="g.id"
        :class="[
          'px-3 py-1 rounded-full text-xs font-medium transition-colors',
          selectedGameId === g.id
            ? 'bg-blue-600 text-white'
            : 'bg-zinc-800 text-zinc-400 hover:text-zinc-100',
        ]"
        @click="selectedGameId = g.id"
      >
        {{ g.mName }}
      </button>
    </div>

    <!-- Sort toggle -->
    <div class="flex gap-2 mb-4">
      <button
        v-for="s in sortOptions"
        :key="s.value"
        :class="[
          'px-3 py-1.5 rounded-md text-xs font-medium transition-colors',
          sortBy === s.value
            ? 'bg-zinc-700 text-zinc-100'
            : 'bg-zinc-800/50 text-zinc-500 hover:text-zinc-300',
        ]"
        @click="sortBy = s.value"
      >
        {{ s.label }}
      </button>
    </div>

    <!-- Achievements grid -->
    <div v-if="filteredAchievements.length === 0" class="py-12 text-center">
      <TrophyIcon class="size-12 text-zinc-700 mx-auto mb-3" />
      <p class="text-zinc-500">{{ $t("account.achievements.empty") }}</p>
    </div>
    <div v-else class="space-y-2">
      <div
        v-for="item in filteredAchievements"
        :key="item.id"
        class="flex items-center gap-3 p-3 rounded-lg bg-zinc-800/50 hover:bg-zinc-700/50 transition-colors"
      >
        <img
          v-if="achievementIcon(item) && !achievementIconErrors[item.id]"
          :src="achievementIcon(item)"
          class="size-10 rounded shrink-0"
          @error="achievementIconErrors[item.id] = true"
        />
        <div
          v-else
          class="size-10 rounded shrink-0 bg-zinc-700/50 flex items-center justify-center"
        >
          <TrophyIcon class="size-5 text-zinc-500" />
        </div>
        <div class="flex-1 min-w-0">
          <p class="text-sm font-medium text-zinc-100 truncate">
            {{ item.achievement?.title }}
          </p>
          <p class="text-xs text-zinc-400 truncate">
            {{ item.achievement?.description }}
          </p>
        </div>
        <NuxtLink
          v-if="item.game"
          :to="`/store/${item.game.id}`"
          class="flex items-center gap-2 shrink-0"
        >
          <img
            v-if="item.game.mIconObjectId"
            :src="useObject(item.game.mIconObjectId)"
            class="size-6 rounded"
          />
          <span
            class="text-xs text-zinc-400 hover:text-blue-400 transition-colors"
          >
            {{ item.game.mName }}
          </span>
        </NuxtLink>
        <span class="text-xs text-zinc-600 shrink-0">
          {{ formatDate(item.unlockedAt) }}
        </span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { TrophyIcon } from "@heroicons/vue/24/solid";
import { useObject } from "~/composables/objects";

// Achievement icon error tracking — show trophy fallback when URL fails or is empty
const achievementIconErrors = reactive<Record<string, boolean>>({});
const achievementIcon = (item: AchievementItem) => {
  const url = item.achievement?.iconUrl;
  return url && url.trim() !== "" ? url : undefined;
};

const { t } = useI18n();
useHead({ title: t("account.achievements.title") });

type AchievementItem = {
  id: string;
  unlockedAt: string;
  achievement?: {
    id: string;
    title: string;
    description: string;
    iconUrl: string;
    gameId: string;
  };
  game?: {
    id: string;
    mName: string;
    mIconObjectId?: string;
    mCoverObjectId?: string;
  };
};

const allAchievements = ref<AchievementItem[]>([]);
const selectedGameId = ref("");
const sortBy = ref<"newest" | "oldest" | "game">("newest");
const syncing = ref(false);

const sortOptions = computed(
  (): { value: "newest" | "oldest" | "game"; label: string }[] => [
    { value: "newest", label: t("account.achievements.sortNewest") },
    { value: "oldest", label: t("account.achievements.sortOldest") },
    { value: "game", label: t("account.achievements.sortGame") },
  ],
);

// Load achievements
const data = (await $dropFetch("/api/v1/user/achievements/list").catch(
  () => [],
)) as AchievementItem[];
allAchievements.value = data;

// Distinct games that have achievements
const gamesWithAchievements = computed(() => {
  const seen = new Map<string, { id: string; mName: string }>();
  for (const item of allAchievements.value) {
    if (item.game && !seen.has(item.game.id)) {
      seen.set(item.game.id, { id: item.game.id, mName: item.game.mName });
    }
  }
  return [...seen.values()].sort((a, b) => a.mName.localeCompare(b.mName));
});

const filteredAchievements = computed(() => {
  let items = allAchievements.value;

  if (selectedGameId.value) {
    items = items.filter((a) => a.game?.id === selectedGameId.value);
  }

  if (sortBy.value === "newest") {
    items = [...items].sort(
      (a, b) =>
        new Date(b.unlockedAt).getTime() - new Date(a.unlockedAt).getTime(),
    );
  } else if (sortBy.value === "oldest") {
    items = [...items].sort(
      (a, b) =>
        new Date(a.unlockedAt).getTime() - new Date(b.unlockedAt).getTime(),
    );
  } else if (sortBy.value === "game") {
    items = [...items].sort((a, b) =>
      (a.game?.mName ?? "").localeCompare(b.game?.mName ?? ""),
    );
  }

  return items;
});

async function syncAchievements() {
  syncing.value = true;
  try {
    await $dropFetch("/api/v1/user/achievements/sync", { method: "POST" });
    const refreshed = (await $dropFetch("/api/v1/user/achievements/list").catch(
      () => [],
    )) as AchievementItem[];
    allAchievements.value = refreshed;
  } finally {
    syncing.value = false;
  }
}

const formatDate = (d: string) => new Date(d).toLocaleDateString();
</script>
