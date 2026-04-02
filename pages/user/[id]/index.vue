<template>
  <div class="max-w-7xl mx-auto px-4">
    <!-- Banner -->
    <div
      v-if="profile?.bannerObjectId"
      class="relative h-48 rounded-t-xl overflow-hidden"
    >
      <img
        :src="useObject(profile.bannerObjectId)"
        class="w-full h-full object-cover"
      />
      <div
        class="absolute inset-0 bg-gradient-to-t from-zinc-950/90 to-transparent"
      />
    </div>
    <div
      v-else
      class="h-32 rounded-t-xl"
      :style="{
        background: `linear-gradient(135deg, ${themeColors.from}, ${themeColors.to})`,
      }"
    />
    <!-- Profile Header -->
    <div class="bg-zinc-900/50 rounded-b-xl p-6 -mt-16 relative">
      <div class="flex items-end gap-4">
        <img
          v-if="profile?.profilePictureObjectId"
          :src="useObject(profile.profilePictureObjectId)"
          class="w-28 h-28 rounded-full border-4 border-zinc-900 object-cover"
        />
        <div
          v-else
          class="w-28 h-28 rounded-full bg-zinc-700 border-4 border-zinc-900"
        />
        <div class="flex-1 pb-2">
          <h1 class="text-2xl font-bold font-display text-zinc-100">
            {{ profile?.displayName ?? profile?.username ?? "Unknown" }}
          </h1>
          <p class="text-zinc-400">@{{ profile?.username }}</p>
        </div>
        <NuxtLink
          v-if="isCurrentUser"
          to="/account"
          class="px-4 py-2 bg-zinc-800 rounded text-sm text-zinc-200 hover:bg-zinc-700"
          >{{ $t("user.editProfile") }}</NuxtLink
        >
      </div>
      <p v-if="profile?.bio" class="mt-4 text-zinc-300">{{ profile.bio }}</p>
    </div>
    <!-- Stats -->
    <div class="grid grid-cols-3 gap-4 my-6">
      <div class="p-4 bg-zinc-800/50 rounded-lg text-center">
        <p class="text-2xl font-bold text-blue-400">
          {{
            userStats?.totalPlaytimeSeconds
              ? Math.round(userStats.totalPlaytimeSeconds / 3600)
              : 0
          }}{{ $t("community.stats.hoursSuffix") }}
        </p>
        <p class="text-sm text-zinc-400">{{ $t("user.stats.playtime") }}</p>
      </div>
      <div class="p-4 bg-zinc-800/50 rounded-lg text-center">
        <p class="text-2xl font-bold text-blue-400">
          {{ userStats?.gamesPlayed ?? 0 }}
        </p>
        <p class="text-sm text-zinc-400">{{ $t("user.stats.gamesPlayed") }}</p>
      </div>
      <div class="p-4 bg-zinc-800/50 rounded-lg text-center">
        <p class="text-2xl font-bold text-blue-400">
          {{ userStats?.achievementsUnlocked ?? 0 }}
        </p>
        <p class="text-sm text-zinc-400">
          {{ $t("user.stats.achievements") }}
        </p>
      </div>
    </div>
    <!-- Favorite Games -->
    <div v-if="favorites?.length" class="mb-6">
      <h2 class="text-lg font-bold font-display text-zinc-100 mb-3">
        {{ $t("user.favorites.title") }}
      </h2>
      <div class="flex gap-3 overflow-x-auto pb-2">
        <NuxtLink
          v-for="fav in favorites"
          :key="fav.gameId"
          :to="`/store/${fav.game?.id}`"
          class="group flex-shrink-0"
        >
          <div
            class="w-24 rounded-lg overflow-hidden ring-1 ring-white/5 hover:ring-blue-500/30 transition-all"
          >
            <div class="aspect-[2/3]">
              <img
                v-if="fav.game?.mCoverObjectId"
                :src="useObject(fav.game.mCoverObjectId)"
                :alt="fav.game?.mName"
                class="size-full object-cover transition-transform duration-300 group-hover:scale-105"
              />
              <div
                v-else
                class="size-full bg-zinc-800 flex items-center justify-center text-zinc-600"
              >
                <SparklesIcon class="size-6" />
              </div>
            </div>
          </div>
          <p class="text-xs text-zinc-400 text-center mt-1 truncate w-24">
            {{ fav.game?.mName }}
          </p>
        </NuxtLink>
      </div>
    </div>

    <!-- Showcase -->
    <div v-if="showcase?.items?.length" class="mb-6">
      <h2 class="text-lg font-bold font-display text-zinc-100 mb-3">
        {{ $t("user.showcase.title") }}
      </h2>
      <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <NuxtLink
          v-for="item in showcase.items"
          :key="item.id"
          :to="item.game ? `/store/${item.game.id}` : undefined"
          class="group relative rounded-lg overflow-hidden bg-zinc-800/50 ring-1 ring-white/5 hover:ring-blue-500/30 transition-all duration-200"
          :class="{ 'pointer-events-none': !item.game }"
        >
          <div class="aspect-[2/3]">
            <img
              v-if="item.game?.mCoverObjectId"
              :src="useObject(item.game.mCoverObjectId)"
              :alt="item.game.mName"
              class="size-full object-cover transition-transform duration-300 group-hover:scale-105"
            />
            <div
              v-else
              class="size-full flex items-center justify-center text-zinc-600"
            >
              <SparklesIcon class="size-8" />
            </div>
          </div>
          <!-- Achievement overlay -->
          <div
            v-if="item.type === 'Achievement' && item.achievement"
            class="absolute inset-x-0 bottom-0 bg-gradient-to-t from-zinc-950/95 to-transparent p-2"
          >
            <div class="flex items-center gap-1.5 mb-0.5">
              <img
                v-if="item.achievement.iconUrl"
                :src="item.achievement.iconUrl"
                class="size-4 rounded-sm"
              />
              <TrophyIcon v-else class="size-4 text-yellow-500" />
              <p class="text-xs font-medium text-zinc-200 truncate">
                {{ item.achievement.title }}
              </p>
            </div>
            <p class="text-[10px] text-zinc-400">
              {{ item.game?.mName }}
            </p>
          </div>
          <!-- GameStats overlay -->
          <div
            v-else-if="item.type === 'GameStats' && item.gameStats"
            class="absolute inset-x-0 bottom-0 bg-gradient-to-t from-zinc-950/95 to-transparent p-2"
          >
            <p class="text-xs font-medium text-zinc-200 truncate mb-1">
              {{ item.game?.mName }}
            </p>
            <p class="text-[10px] text-blue-400">
              {{
                item.gameStats.playtimeSeconds
                  ? Math.round(item.gameStats.playtimeSeconds / 3600) +
                    $t("community.stats.hoursSuffix")
                  : $t("user.stats.noPlaytime")
              }}
            </p>
            <div v-if="item.gameStats.achievementsTotal > 0" class="mt-1">
              <div class="h-1 rounded-full bg-zinc-700 overflow-hidden">
                <div
                  class="h-full rounded-full bg-blue-500"
                  :style="{
                    width:
                      Math.round(
                        (item.gameStats.achievementsUnlocked /
                          item.gameStats.achievementsTotal) *
                          100,
                      ) + '%',
                  }"
                />
              </div>
              <p class="text-[10px] text-zinc-500 mt-0.5">
                {{ item.gameStats.achievementsUnlocked }}/{{
                  item.gameStats.achievementsTotal
                }}
              </p>
            </div>
          </div>
          <!-- Default overlay (FavoriteGame / Custom) -->
          <div
            v-else
            class="absolute inset-x-0 bottom-0 bg-gradient-to-t from-zinc-950/90 to-transparent p-2"
          >
            <p class="text-xs font-medium text-zinc-200 truncate">
              {{ item.title || item.game?.mName || $t("user.showcase.custom") }}
            </p>
            <p class="text-[10px] text-zinc-400 uppercase tracking-wide">
              {{ showcaseTypeLabels[item.type] }}
            </p>
          </div>
          <!-- Completion badge for game items -->
          <div
            v-if="
              item.type !== 'GameStats' && item.gameStats?.achievementsTotal > 0
            "
            class="absolute top-1.5 right-1.5 px-1.5 py-0.5 rounded-full text-[10px] font-bold"
            :class="
              item.gameStats.achievementsUnlocked >=
              item.gameStats.achievementsTotal
                ? 'bg-yellow-500/90 text-yellow-950'
                : 'bg-zinc-900/80 text-zinc-300'
            "
          >
            {{
              Math.round(
                (item.gameStats.achievementsUnlocked /
                  item.gameStats.achievementsTotal) *
                  100,
              )
            }}%
          </div>
        </NuxtLink>
      </div>
    </div>

    <!-- Activity -->
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div>
        <h2 class="text-lg font-bold font-display text-zinc-100 mb-3">
          {{ $t("user.stats.recentActivity") }}
        </h2>
        <div v-if="activityLoading" class="text-zinc-500">
          {{ $t("common.srLoading") }}
        </div>
        <div v-else>
          <div
            v-for="s in userStats?.recentSessions?.slice(0, 5)"
            :key="s.id"
            class="flex items-center gap-3 p-3 bg-zinc-800/30 rounded mb-2"
          >
            <img
              v-if="s.game?.mIconObjectId"
              :src="useObject(s.game.mIconObjectId)"
              class="size-8 rounded"
            />
            <div class="flex-1 min-w-0">
              <p class="text-sm text-zinc-100 truncate">{{ s.game?.mName }}</p>
              <p class="text-xs text-zinc-500">
                {{
                  s.durationSeconds
                    ? Math.round(s.durationSeconds / 60) +
                      $t("user.stats.minutesSuffix")
                    : $t("user.stats.unknownDuration")
                }}
              </p>
            </div>
          </div>
          <p
            v-if="!userStats?.recentSessions?.length"
            class="text-zinc-500 text-sm"
          >
            {{ $t("user.stats.noSessions") }}
          </p>
        </div>
      </div>
      <div>
        <div class="flex items-center justify-between mb-3">
          <h2 class="text-lg font-bold font-display text-zinc-100">
            {{ $t("user.stats.recentAchievements") }}
          </h2>
          <select
            v-if="achievementGames.length > 1"
            v-model="selectedAchGameId"
            class="text-xs bg-zinc-800 border-zinc-700 text-zinc-300 rounded-md px-2 py-1 focus:ring-blue-500 focus:border-blue-500"
          >
            <option value="">
              {{ $t("account.achievements.allGames") }}
            </option>
            <option v-for="g in achievementGames" :key="g.id" :value="g.id">
              {{ g.mName }}
            </option>
          </select>
        </div>
        <div v-if="activityLoading" class="text-zinc-500">
          {{ $t("common.srLoading") }}
        </div>
        <div v-else>
          <div
            v-for="a in filteredAchievements"
            :key="a.id"
            class="flex items-center gap-3 p-3 bg-zinc-800/30 rounded mb-2"
          >
            <img
              v-if="achievementIcon(a) && !achievementIconErrors[a.id]"
              :src="achievementIcon(a)"
              class="size-8 rounded"
              @error="achievementIconErrors[a.id] = true"
            />
            <div
              v-else
              class="size-8 rounded shrink-0 bg-zinc-700/50 flex items-center justify-center"
            >
              <TrophyIcon class="size-4 text-zinc-500" />
            </div>
            <div class="flex-1 min-w-0">
              <p class="text-sm text-zinc-100 truncate">
                {{ a.achievement?.title }}
              </p>
              <p class="text-xs text-zinc-500">{{ a.game?.mName }}</p>
            </div>
          </div>
          <p
            v-if="!activity?.achievements?.length"
            class="text-zinc-500 text-sm"
          >
            {{ $t("user.stats.noAchievements") }}
          </p>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { SparklesIcon } from "@heroicons/vue/24/outline";
import { TrophyIcon } from "@heroicons/vue/24/solid";
import { useObject } from "~/composables/objects";
import { useUser } from "~/composables/user";

const { t } = useI18n();
// Static map — avoids @intlify/vue-i18n/no-dynamic-keys violation
const showcaseTypeLabels = computed<Record<string, string>>(() => ({
  Achievement: t("user.showcase.types.Achievement"),
  Custom: t("user.showcase.types.Custom"),
  FavoriteGame: t("user.showcase.types.FavoriteGame"),
  GameStats: t("user.showcase.types.GameStats"),
}));

const THEME_MAP: Record<string, { from: string; to: string }> = {
  default: { from: "#1e3a5f", to: "#581c87" },
  ocean: { from: "#0c4a6e", to: "#164e63" },
  sunset: { from: "#9a3412", to: "#831843" },
  forest: { from: "#14532d", to: "#1a2e05" },
  ember: { from: "#7c2d12", to: "#451a03" },
  arctic: { from: "#0e7490", to: "#1e40af" },
  midnight: { from: "#1e1b4b", to: "#0f172a" },
  rose: { from: "#9f1239", to: "#4c0519" },
};

const route = useRoute();
const id = (route.params.id ?? "") as string;
const loading = ref(true);

const profile = (await $dropFetch(`/api/v1/user/${id}`).catch(() => null)) as {
  id?: string;
  username?: string;
  displayName?: string;
  bio?: string;
  profilePictureObjectId?: string;
  bannerObjectId?: string;
  profileTheme?: string;
} | null;
const themeColors = computed(
  () => THEME_MAP[profile?.profileTheme ?? "default"] ?? THEME_MAP.default,
);
const userStats = await $dropFetch(`/api/v1/user/${id}/stats`).catch(
  () => null,
);
type ActivityAchievement = {
  id: string;
  achievement?: { title?: string; iconUrl?: string };
  game?: { id: string; mName: string; mIconObjectId?: string };
};
const activity = (await $dropFetch(`/api/v1/user/${id}/activity`).catch(
  () => null,
)) as { achievements?: ActivityAchievement[] } | null;
const showcase = await $dropFetch(`/api/v1/user/${id}/showcase`).catch(
  () => null,
);
const favorites = (await $dropFetch(`/api/v1/user/${id}/favorites`).catch(
  () => null,
)) as Array<{
  gameId: string;
  game?: {
    id: string;
    mName: string;
    mCoverObjectId?: string;
    mIconObjectId?: string;
  } | null;
}> | null;
const activityLoading = ref(false);

// Achievement icon error tracking — show trophy fallback when URL fails or is empty
const achievementIconErrors = reactive<Record<string, boolean>>({});
const achievementIcon = (a: { achievement?: { iconUrl?: string } }) => {
  const url = a.achievement?.iconUrl;
  return url && url.trim() !== "" ? url : undefined;
};

// Game filter for achievements section
const selectedAchGameId = ref("");
const achievementGames = computed(() => {
  const seen = new Map<string, { id: string; mName: string }>();
  for (const a of activity?.achievements ?? []) {
    if (a.game && !seen.has(a.game.id)) {
      seen.set(a.game.id, { id: a.game.id, mName: a.game.mName });
    }
  }
  return [...seen.values()].sort((x, y) => x.mName.localeCompare(y.mName));
});
const filteredAchievements = computed(() => {
  const all = activity?.achievements ?? [];
  const filtered = selectedAchGameId.value
    ? all.filter((a) => a.game?.id === selectedAchGameId.value)
    : all;
  return filtered.slice(0, 10);
});

loading.value = false;
const current = useUser();
const isCurrentUser = computed(
  () => !!current.value && current.value.id === profile?.id,
);
useHead({ title: profile?.displayName ?? profile?.username ?? "User" });
</script>
