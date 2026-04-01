<template>
  <div class="max-w-7xl mx-auto px-4 py-8">
    <h1 class="text-3xl font-bold font-display text-zinc-100 mb-8">
      {{ $t("community.title") }}
    </h1>

    <!-- Stats grid -->
    <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
      <div class="p-4 bg-zinc-800/50 rounded-lg text-center">
        <p class="text-2xl font-bold text-blue-400">
          {{ stats?.totalGames || 0 }}
        </p>
        <p class="text-sm text-zinc-400">{{ $t("community.stats.games") }}</p>
      </div>
      <div class="p-4 bg-zinc-800/50 rounded-lg text-center">
        <p class="text-2xl font-bold text-blue-400">
          {{ stats?.totalUsers || 0 }}
        </p>
        <p class="text-sm text-zinc-400">
          {{ $t("community.stats.players") }}
        </p>
      </div>
      <div class="p-4 bg-zinc-800/50 rounded-lg text-center">
        <p class="text-2xl font-bold text-blue-400">
          {{ stats?.totalPlaytimeHours || 0
          }}{{ $t("community.stats.hoursSuffix") }}
        </p>
        <p class="text-sm text-zinc-400">
          {{ $t("community.stats.totalPlaytime") }}
        </p>
      </div>
      <NuxtLink
        to="/requests"
        class="p-4 bg-zinc-800/50 hover:bg-zinc-700/60 rounded-lg text-center transition-colors group"
      >
        <p class="text-2xl font-bold text-yellow-400">
          {{ stats?.pendingRequests || 0 }}
        </p>
        <p
          class="text-sm text-zinc-400 group-hover:text-zinc-200 transition-colors"
        >
          {{ $t("community.stats.pendingRequests") }}
        </p>
      </NuxtLink>
    </div>

    <!-- Main content: activity + leaderboard -->
    <div class="grid grid-cols-1 lg:grid-cols-3 gap-8">
      <!-- Activity feed (2/3 width) -->
      <div class="lg:col-span-2">
        <h2 class="text-xl font-bold font-display text-zinc-100 mb-4">
          {{ $t("community.recentActivity") }}
        </h2>
        <ActivityFeed
          :items="activity"
          :has-more="hasMore"
          :loading-more="loadingMore"
          @load-more="loadMore"
        />
      </div>

      <!-- Top players (1/3 width) -->
      <div>
        <h2 class="text-xl font-bold font-display text-zinc-100 mb-4">
          {{ $t("community.topPlayers") }}
        </h2>
        <div class="space-y-2">
          <LeaderboardRow
            v-for="e in leaderboard?.playtime?.slice(0, 10)"
            :key="e.rank"
            :rank="e.rank"
            :user="e.user"
            :playtime-hours="e.playtimeHours"
            :achievements="e.achievements"
            :games-owned="e.gamesOwned"
          />
        </div>
      </div>
    </div>
  </div>
</template>

<script lang="ts" setup>
const { t } = useI18n();
useHead({ title: t("community.title") });

type ActivityItem = {
  type: string;
  timestamp: Date | string;
  user?: {
    id?: string;
    username?: string;
    displayName?: string;
    profilePictureObjectId?: string;
  };
  game?: { id?: string; mName?: string; mIconObjectId?: string };
  data?: {
    achievement?: { title?: string; iconUrl?: string };
    request?: { id?: string; title?: string };
  };
};

const LIMIT = 30;
const activity = ref<ActivityItem[]>([]);
const hasMore = ref(false);
const loadingMore = ref(false);

const initialActivity = (await $dropFetch("/api/v1/community/activity", {
  query: { limit: LIMIT + 1 },
}).catch(() => [])) as ActivityItem[];

// If we got more than LIMIT, there are more pages
if (initialActivity.length > LIMIT) {
  hasMore.value = true;
  activity.value = initialActivity.slice(0, LIMIT);
} else {
  activity.value = initialActivity;
}

async function loadMore() {
  if (loadingMore.value || activity.value.length === 0) return;
  loadingMore.value = true;
  const last = activity.value[activity.value.length - 1];
  const before = new Date(last.timestamp).toISOString();
  try {
    const more = (await $dropFetch("/api/v1/community/activity", {
      query: { limit: LIMIT + 1, before },
    }).catch(() => [])) as ActivityItem[];
    if (more.length > LIMIT) {
      hasMore.value = true;
      activity.value = [...activity.value, ...more.slice(0, LIMIT)];
    } else {
      hasMore.value = false;
      activity.value = [...activity.value, ...more];
    }
  } finally {
    loadingMore.value = false;
  }
}

const stats = await $dropFetch("/api/v1/community/stats").catch(() => null);
const leaderboard = await $dropFetch("/api/v1/community/leaderboard").catch(
  () => ({ playtime: [] }),
);
</script>
