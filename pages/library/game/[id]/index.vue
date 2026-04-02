<!-- eslint-disable vue/no-v-html -->
<template>
  <div
    class="mx-auto w-full relative flex flex-col justify-center pt-72 overflow-hidden"
  >
    <!-- Banner background with gradient overlays -->
    <div class="absolute inset-0 z-0 rounded-xl overflow-hidden">
      <img
        :src="useObject(game.mBannerObjectId)"
        class="w-full h-[24rem] object-cover blur-sm scale-105"
      />
      <div
        class="absolute inset-0 bg-gradient-to-t from-zinc-900 to-transparent opacity-90"
      />
      <div
        class="absolute inset-0 bg-gradient-to-r from-zinc-900/95 via-zinc-900/80 to-transparent opacity-90"
      />
    </div>

    <div class="relative z-10">
      <div class="px-4 sm:px-8 pb-4">
        <div class="flex items-center gap-x-3 mb-4">
          <NuxtLink
            to="/library"
            class="transition text-sm/6 font-semibold text-zinc-400 hover:text-zinc-100 inline-flex gap-x-2 items-center duration-200 hover:scale-105"
          >
            <ArrowLeftIcon class="h-4 w-4" aria-hidden="true" />
            {{ $t("library.back") }}
          </NuxtLink>
        </div>

        <!-- Game title and description -->
        <h1
          class="text-3xl sm:text-5xl text-zinc-100 font-bold font-display drop-shadow-lg"
        >
          {{ game.mName }}
        </h1>

        <div class="flex items-stretch flex-col lg:flex-row gap-3 mt-6">
          <button
            type="button"
            class="inline-flex items-center justify-center gap-x-2 rounded-md bg-blue-600 px-3.5 py-2.5 text-base font-semibold font-display text-white shadow-sm transition-all duration-200 hover:bg-blue-500 hover:scale-105 hover:shadow-blue-500/25 hover:shadow-lg active:scale-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
          >
            {{ $t("library.launcherOpen") }}
            <ArrowTopRightOnSquareIcon
              class="-mr-0.5 h-5 w-5"
              aria-hidden="true"
            />
          </button>
          <div class="relative z-50">
            <AddLibraryButton class="font-bold" :game-id="game.id" />
          </div>
          <NuxtLink
            :to="`/store/${game.id}`"
            class="inline-flex items-center justify-center gap-x-2 rounded-md bg-zinc-800 px-3.5 py-2.5 text-base font-semibold font-display text-white shadow-sm transition-all duration-200 hover:bg-zinc-700 hover:scale-105 hover:shadow-lg active:scale-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-600"
          >
            {{ $t("store.viewInStore") }}
            <ArrowUpRightIcon class="-mr-0.5 h-5 w-5" aria-hidden="true" />
          </NuxtLink>
        </div>
      </div>

      <!-- Main content -->
      <div class="w-full bg-zinc-900 px-4 sm:px-8 py-6">
        <div class="mt-4 grid grid-cols-1 lg:grid-cols-4 gap-10">

          <!-- Sidebar: cover + metadata -->
          <div class="lg:col-start-4 flex flex-col gap-y-6 items-center">
            <img
              class="transition-all duration-300 hover:scale-105 hover:rotate-[-1deg] w-48 h-auto rounded"
              :src="useObject(game.mCoverObjectId)"
              :alt="game.mName"
            />

            <table class="min-w-full">
              <tbody>
                <tr>
                  <td class="whitespace-nowrap py-3 pl-2 pr-3 text-sm font-medium text-zinc-100">
                    {{ $t("store.released") }}
                  </td>
                  <td class="whitespace-nowrap px-3 py-3 text-sm text-zinc-400">
                    <time :datetime="game.mReleased">
                      {{ $d(new Date(game.mReleased), "short") }}
                    </time>
                  </td>
                </tr>
                <tr>
                  <td class="whitespace-nowrap py-3 pl-2 pr-3 text-sm font-medium text-zinc-100">
                    {{ $t("store.platform", platforms.length) }}
                  </td>
                  <td class="whitespace-nowrap inline-flex gap-x-3 px-3 py-3 text-sm text-zinc-400">
                    <component
                      :is="PLATFORM_ICONS[platform]"
                      v-for="platform in platforms"
                      :key="platform"
                      class="text-blue-600 w-5 h-5"
                    />
                    <span v-if="platforms.length === 0" class="font-semibold text-blue-600">
                      {{ $t("store.commingSoon") }}
                    </span>
                  </td>
                </tr>
                <tr>
                  <td class="whitespace-nowrap py-3 pl-2 pr-3 text-sm font-medium text-zinc-100">
                    {{ $t("store.size") }}
                  </td>
                  <td v-if="sizes.length > 0" class="whitespace-nowrap inline-flex gap-x-3 px-3 py-3 text-sm text-zinc-400">
                    <ul class="flex flex-col gap-1">
                      <ol
                        v-for="version in sizes"
                        :key="version.versionId"
                        class="inline-flex items-center gap-x-1"
                      >
                        <ServerIcon class="size-4" />
                        {{ formatBytes(version.installSize) }}
                        <CloudIcon class="size-4 ml-2" />
                        {{ formatBytes(version.downloadSize) }}
                      </ol>
                    </ul>
                  </td>
                  <td v-else class="whitespace-nowrap px-3 py-3 text-sm text-zinc-400">
                    <span class="font-semibold text-blue-600">{{ $t("store.commingSoon") }}</span>
                  </td>
                </tr>
                <tr>
                  <td class="whitespace-nowrap py-3 pl-2 pr-3 text-sm font-medium text-zinc-100">
                    {{ $t("store.rating") }}
                  </td>
                  <td class="whitespace-nowrap flex flex-row items-center gap-x-1 px-3 py-3 text-sm text-zinc-400">
                    <StarIcon
                      v-for="(value, idx) in ratingArray"
                      :key="idx"
                      :class="[value ? 'text-yellow-600' : 'text-zinc-600', 'w-4 h-4']"
                    />
                    <span class="text-zinc-600">{{ $t("store.reviews", [$n(rating._sum.mReviewCount ?? 0)]) }}</span>
                  </td>
                </tr>
                <tr v-if="game.tags.length > 0">
                  <td class="whitespace-nowrap align-top py-3 pl-2 pr-3 text-sm font-medium text-zinc-100">
                    {{ $t("store.tags") }}
                  </td>
                  <td class="flex flex-col gap-1 px-3 py-3 text-sm text-zinc-400">
                    <NuxtLink
                      v-for="tag in game.tags"
                      :key="tag.id"
                      :href="`/store/t/${tag.id}`"
                      class="w-min hover:underline hover:text-zinc-100 whitespace-nowrap"
                    >
                      {{ tag.name }}
                    </NuxtLink>
                  </td>
                </tr>
                <tr v-if="game.developers.length > 0">
                  <td class="whitespace-nowrap align-top py-3 pl-2 pr-3 text-sm font-medium text-zinc-100">
                    {{ $t("store.developers", game.developers.length) }}
                  </td>
                  <td class="flex flex-col px-3 py-3 text-sm text-zinc-400">
                    <NuxtLink
                      v-for="developer in game.developers"
                      :key="developer.id"
                      :href="`/store/c/${developer.id}`"
                      class="hover:underline hover:text-zinc-100 whitespace-nowrap"
                    >
                      {{ developer.mName }}
                    </NuxtLink>
                  </td>
                </tr>
                <tr v-if="game.publishers.length > 0">
                  <td class="whitespace-nowrap align-top py-3 pl-2 pr-3 text-sm font-medium text-zinc-100">
                    {{ $t("store.publishers", game.publishers.length) }}
                  </td>
                  <td class="flex flex-col px-3 py-3 text-sm text-zinc-400">
                    <NuxtLink
                      v-for="publisher in game.publishers"
                      :key="publisher.id"
                      :href="`/store/c/${publisher.id}`"
                      class="hover:underline hover:text-zinc-100 whitespace-nowrap"
                    >
                      {{ publisher.mName }}
                    </NuxtLink>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <!-- Main: short desc + carousel + description + tabs -->
          <div class="row-start-2 lg:row-start-1 lg:col-span-3 space-y-8">

            <!-- Short description -->
            <p class="text-lg text-zinc-400">{{ game.mShortDescription }}</p>

            <!-- Image carousel -->
            <div class="bg-zinc-800/50 rounded-xl p-4 backdrop-blur-sm">
              <h2 class="text-base font-display font-semibold text-zinc-100 mb-3">
                {{ $t("store.images") }}
              </h2>
              <VueCarousel :items-to-show="1" :wrap-around="true">
                <VueSlide
                  v-for="image in game.mImageCarouselObjectIds"
                  :key="image"
                >
                  <img class="w-fit h-48 lg:h-80 rounded" :src="useObject(image)" />
                </VueSlide>
                <VueSlide v-if="game.mImageCarouselObjectIds.length === 0">
                  <div class="h-48 lg:h-80 aspect-[1/2] flex items-center justify-center text-zinc-700 font-bold font-display">
                    {{ $t("store.noImages") }}
                  </div>
                </VueSlide>
                <template #addons>
                  <VueNavigation />
                  <CarouselPagination class="py-2 px-12" />
                </template>
              </VueCarousel>
            </div>

            <!-- Full description -->
            <div
              class="prose prose-invert prose-blue max-w-none"
              v-html="descriptionHTML"
            />

            <!-- Tabs: Achievements / Leaderboards / Similar Games -->
            <div>
              <div class="border-b border-zinc-700 mb-4">
                <nav class="flex gap-4">
                  <button
                    v-for="tab in tabs"
                    :key="tab"
                    :class="[
                      activeTab === tab
                        ? 'border-blue-400 text-blue-400'
                        : 'border-transparent text-zinc-400 hover:text-zinc-200',
                      'pb-2 px-1 border-b-2 text-sm font-medium transition-colors',
                    ]"
                    @click="activeTab = tab"
                  >
                    {{ tabLabels[tab] }}
                  </button>
                </nav>
              </div>

              <!-- Achievements Tab -->
              <div v-if="activeTab === 'Achievements'">
                <div v-if="achievementsLoading" class="text-zinc-500">
                  {{ $t("common.srLoading") }}
                </div>
                <div
                  v-else-if="achievements.length === 0"
                  class="text-zinc-500 text-center py-8"
                >
                  {{ $t("store.review.noAchievements") }}
                </div>
                <div v-else class="space-y-2">
                  <AchievementCard
                    v-for="a in achievements"
                    :key="a.id"
                    :achievement="a"
                    :unlocked-at="a.unlockedAt"
                    :rarity="a.rarity"
                  />
                  <div class="mt-4 text-sm text-zinc-400">
                    {{
                      $t("store.review.unlockCount", {
                        unlocked: achievements.filter((a) => a.unlocked).length,
                        total: achievements.length,
                      })
                    }}
                  </div>
                </div>
              </div>

              <!-- Leaderboards Tab -->
              <div v-if="activeTab === 'Leaderboards'">
                <div v-if="leaderboards.length === 0" class="text-zinc-500 text-center py-8">
                  {{ $t("store.leaderboard.empty") }}
                </div>
                <div v-else class="space-y-8">
                  <div v-for="lb in leaderboards" :key="lb.id">
                    <h3 class="text-base font-semibold text-zinc-100 mb-3 flex items-center gap-2">
                      {{ lb.name }}
                      <span class="text-xs font-normal text-zinc-500 bg-zinc-800 px-2 py-0.5 rounded-full">
                        {{ leaderboardTypeLabels[lb.type] }}
                      </span>
                    </h3>
                    <GameLeaderboard :game-id="id" :board-id="lb.id" :board-type="lb.type" />
                  </div>
                </div>
              </div>

              <!-- Similar Games Tab -->
              <div v-if="activeTab === 'Similar'">
                <div v-if="similarLoading" class="text-zinc-500">
                  {{ $t("common.srLoading") }}
                </div>
                <div v-else-if="similarGames.length === 0" class="text-zinc-500 text-center py-8">
                  {{ $t("store.review.noSimilar") }}
                </div>
                <GameCarousel v-else :items="similarGames" />
              </div>
            </div>

          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import {
  ArrowLeftIcon,
  ArrowTopRightOnSquareIcon,
  ArrowUpRightIcon,
} from "@heroicons/vue/20/solid";
import { StarIcon, ServerIcon, CloudIcon } from "@heroicons/vue/24/solid";
import type { SerializeObject } from "nitropack";
import type { GameModel } from "~/prisma/client/models";
import { micromark } from "micromark";
import { formatBytes } from "~/server/internal/utils/files";

const { t } = useI18n();
const route = useRoute();
const id = route.params.id.toString();

const leaderboardTypeLabels = computed<Record<string, string>>(() => ({
  AchievementCount: t("store.leaderboard.types.AchievementCount"),
  Playtime: t("store.leaderboard.types.Playtime"),
  Score: t("store.leaderboard.types.Score"),
  Speedrun: t("store.leaderboard.types.Speedrun"),
}));

const { game, rating, sizes, platforms } = await $dropFetch(`/api/v1/games/${id}`);

if (!game) {
  throw createError({ statusCode: 404, message: t("library.notFound") });
}

const descriptionHTML = micromark(game.mDescription ?? "");
const averageRating = Math.round((rating._avg.mReviewRating ?? 0) * 5);
const ratingArray = Array(5)
  .fill(null)
  .map((_, i) => i + 1 <= averageRating);

// Platform icons (auto-imported composable from composables/icons.ts)

const tabs = ["Achievements", "Leaderboards", "Similar"] as const;
const tabLabels: Record<string, string> = {
  Achievements: t("store.tabs.achievements"),
  Leaderboards: t("store.tabs.leaderboards"),
  Similar: t("store.tabs.similar"),
};
const activeTab = ref<"Achievements" | "Leaderboards" | "Similar">("Achievements");

// Achievements
const achievementsLoading = ref(true);
const achievements = await $dropFetch(`/api/v1/games/${id}/achievements`).catch(() => []);
achievementsLoading.value = false;

// Leaderboards
type LeaderboardMeta = { id: string; name: string; type: string; entryCount: number };
const leaderboards = (await $dropFetch(`/api/v1/games/${id}/leaderboards`).catch(() => [])) as LeaderboardMeta[];

// Similar games
const similarGames = ref<SerializeObject<GameModel>[]>([]);
const similarLoading = ref(true);
const gameTagIds = game.tags.map((t: { id: string }) => t.id);
if (gameTagIds.length > 0) {
  const similar = await $fetch("/api/v1/store", {
    query: { take: 10, sort: "default", tags: gameTagIds.join(",") },
  }).catch(() => null);
  if (similar) {
    similarGames.value = (similar.results as SerializeObject<GameModel>[]).filter(
      (g: SerializeObject<GameModel>) => g.id !== id,
    );
  }
}
similarLoading.value = false;

useHead({ title: game.mName });
</script>

<style scoped>
.slide-enter-active,
.slide-leave-active {
  transition: all 0.3s ease;
  position: absolute;
}
.slide-enter-from {
  opacity: 0;
  transform: translateX(100%);
}
.slide-leave-to {
  opacity: 0;
  transform: translateX(-100%);
}
</style>
