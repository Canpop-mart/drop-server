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
        class="absolute inset-0 bg-gradient-to-t from-zinc-900 via-zinc-900/80 to-transparent opacity-90"
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

        <!-- Game title -->
        <h1
          class="text-3xl sm:text-5xl text-zinc-100 font-bold font-display drop-shadow-lg"
        >
          {{ game.mName }}
        </h1>

        <!-- Action buttons -->
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

      <!-- Main content — mirrors client layout: description left, images+achievements right -->
      <div class="mt-8 w-full bg-zinc-900 px-4 sm:px-8 py-6">
        <div class="grid grid-cols-[2fr,1fr] gap-8">
          <!-- Left column: description + metadata + leaderboards + similar -->
          <div class="space-y-4">
            <!-- Collapsible About (matches client style) -->
            <div
              class="bg-zinc-800/50 rounded-xl backdrop-blur-sm overflow-hidden"
            >
              <button
                class="w-full flex items-center justify-between p-6 text-left hover:bg-zinc-700/30 transition-colors"
                @click="descriptionOpen = !descriptionOpen"
              >
                <h2 class="text-xl font-display font-semibold text-zinc-100">
                  {{ $t("store.about") }}
                </h2>
                <ChevronDownIcon
                  class="size-5 text-zinc-400 transition-transform duration-200"
                  :class="{ 'rotate-180': descriptionOpen }"
                />
              </button>
              <Transition
                enter-active-class="transition-all duration-300 ease-out"
                enter-from-class="max-h-0 opacity-0"
                enter-to-class="max-h-[2000px] opacity-100"
                leave-active-class="transition-all duration-200 ease-in"
                leave-from-class="max-h-[2000px] opacity-100"
                leave-to-class="max-h-0 opacity-0"
              >
                <div v-show="descriptionOpen" class="overflow-hidden">
                  <div class="px-6 pb-6">
                    <p class="text-zinc-400 text-sm mb-4">
                      {{ game.mShortDescription }}
                    </p>
                    <div
                      class="prose prose-invert prose-blue overflow-y-auto custom-scrollbar max-w-none"
                      v-html="descriptionHTML"
                    />
                  </div>
                </div>
              </Transition>
            </div>

            <!-- Metadata: release date, platforms, sizes, rating, tags, devs, publishers -->
            <div
              class="bg-zinc-800/50 rounded-xl backdrop-blur-sm overflow-hidden"
            >
              <button
                class="w-full flex items-center justify-between p-6 text-left hover:bg-zinc-700/30 transition-colors"
                @click="detailsOpen = !detailsOpen"
              >
                <h2 class="text-xl font-display font-semibold text-zinc-100">
                  {{ $t("store.details") }}
                </h2>
                <ChevronDownIcon
                  class="size-5 text-zinc-400 transition-transform duration-200"
                  :class="{ 'rotate-180': detailsOpen }"
                />
              </button>
              <Transition
                enter-active-class="transition-all duration-300 ease-out"
                enter-from-class="max-h-0 opacity-0"
                enter-to-class="max-h-[1000px] opacity-100"
                leave-active-class="transition-all duration-200 ease-in"
                leave-from-class="max-h-[1000px] opacity-100"
                leave-to-class="max-h-0 opacity-0"
              >
                <div v-show="detailsOpen" class="overflow-hidden">
                  <div class="px-6 pb-6">
                    <table class="min-w-full">
                      <tbody>
                        <tr>
                          <td
                            class="whitespace-nowrap py-2 pr-3 text-sm font-medium text-zinc-100"
                          >
                            {{ $t("store.released") }}
                          </td>
                          <td
                            class="whitespace-nowrap px-3 py-2 text-sm text-zinc-400"
                          >
                            <time :datetime="game.mReleased">
                              {{ $d(new Date(game.mReleased), "short") }}
                            </time>
                          </td>
                        </tr>
                        <tr>
                          <td
                            class="whitespace-nowrap py-2 pr-3 text-sm font-medium text-zinc-100"
                          >
                            {{ $t("store.platform", platforms.length) }}
                          </td>
                          <td
                            class="whitespace-nowrap inline-flex gap-x-3 px-3 py-2 text-sm text-zinc-400"
                          >
                            <component
                              :is="PLATFORM_ICONS[platform]"
                              v-for="platform in platforms"
                              :key="platform"
                              class="text-blue-600 w-5 h-5"
                            />
                            <span
                              v-if="platforms.length === 0"
                              class="font-semibold text-blue-600"
                            >
                              {{ $t("store.commingSoon") }}
                            </span>
                          </td>
                        </tr>
                        <tr>
                          <td
                            class="whitespace-nowrap py-2 pr-3 text-sm font-medium text-zinc-100"
                          >
                            {{ $t("store.size") }}
                          </td>
                          <td
                            v-if="sizes.length > 0"
                            class="whitespace-nowrap inline-flex gap-x-3 px-3 py-2 text-sm text-zinc-400"
                          >
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
                          <td
                            v-else
                            class="whitespace-nowrap px-3 py-2 text-sm text-zinc-400"
                          >
                            <span class="font-semibold text-blue-600">{{
                              $t("store.commingSoon")
                            }}</span>
                          </td>
                        </tr>
                        <tr>
                          <td
                            class="whitespace-nowrap py-2 pr-3 text-sm font-medium text-zinc-100"
                          >
                            {{ $t("store.rating") }}
                          </td>
                          <td
                            class="whitespace-nowrap flex flex-row items-center gap-x-1 px-3 py-2 text-sm text-zinc-400"
                          >
                            <StarIcon
                              v-for="(value, idx) in ratingArray"
                              :key="idx"
                              :class="[
                                value ? 'text-yellow-600' : 'text-zinc-600',
                                'w-4 h-4',
                              ]"
                            />
                            <span class="text-zinc-600">{{
                              $t("store.reviews", [
                                $n(rating._sum.mReviewCount ?? 0),
                              ])
                            }}</span>
                          </td>
                        </tr>
                        <tr v-if="game.tags.length > 0">
                          <td
                            class="whitespace-nowrap align-top py-2 pr-3 text-sm font-medium text-zinc-100"
                          >
                            {{ $t("store.tags") }}
                          </td>
                          <td
                            class="flex flex-col gap-1 px-3 py-2 text-sm text-zinc-400"
                          >
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
                          <td
                            class="whitespace-nowrap align-top py-2 pr-3 text-sm font-medium text-zinc-100"
                          >
                            {{
                              $t("store.developers", game.developers.length)
                            }}
                          </td>
                          <td
                            class="flex flex-col px-3 py-2 text-sm text-zinc-400"
                          >
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
                          <td
                            class="whitespace-nowrap align-top py-2 pr-3 text-sm font-medium text-zinc-100"
                          >
                            {{
                              $t("store.publishers", game.publishers.length)
                            }}
                          </td>
                          <td
                            class="flex flex-col px-3 py-2 text-sm text-zinc-400"
                          >
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
                </div>
              </Transition>
            </div>

            <!-- Leaderboards -->
            <div
              v-if="leaderboards.length > 0"
              class="bg-zinc-800/50 rounded-xl p-6 backdrop-blur-sm space-y-4"
            >
              <h2 class="text-xl font-display font-semibold text-zinc-100">
                {{ $t("store.tabs.leaderboards") }}
              </h2>
              <div v-for="lb in leaderboards" :key="lb.id">
                <h3
                  class="text-sm font-semibold text-zinc-100 mb-3 flex items-center gap-2"
                >
                  {{ lb.name }}
                  <span
                    class="text-xs font-normal text-zinc-500 bg-zinc-700 px-2 py-0.5 rounded-full"
                  >
                    {{ leaderboardTypeLabels[lb.type] }}
                  </span>
                </h3>
                <GameLeaderboard
                  :game-id="id"
                  :board-id="lb.id"
                  :board-type="lb.type"
                />
              </div>
            </div>

            <!-- Similar games -->
            <div
              v-if="similarGames.length > 0"
              class="bg-zinc-800/50 rounded-xl p-6 backdrop-blur-sm"
            >
              <h2
                class="text-xl font-display font-semibold text-zinc-100 mb-4"
              >
                {{ $t("store.tabs.similar") }}
              </h2>
              <GameCarousel :items="similarGames" />
            </div>
          </div>

          <!-- Right column: Game Images + Achievements (mirrors client sidebar) -->
          <div class="space-y-6">
            <!-- Game Images carousel -->
            <div class="bg-zinc-800/50 rounded-xl p-6 backdrop-blur-sm">
              <h2
                class="text-xl font-display font-semibold text-zinc-100 mb-4"
              >
                {{ $t("store.images") }}
              </h2>
              <div class="relative">
                <div v-if="game.mImageCarouselObjectIds.length > 0">
                  <div
                    class="relative aspect-video rounded-lg overflow-hidden cursor-pointer group"
                  >
                    <div
                      class="absolute inset-0"
                      @click="
                        fullscreenImage =
                          game.mImageCarouselObjectIds[currentImageIndex]
                      "
                    >
                      <TransitionGroup name="slide" tag="div" class="h-full">
                        <img
                          v-for="(url, index) in game.mImageCarouselObjectIds"
                          v-show="index === currentImageIndex"
                          :key="url"
                          :src="useObject(url)"
                          class="absolute inset-0 w-full h-full object-cover"
                        />
                      </TransitionGroup>
                    </div>

                    <!-- Prev / Next arrows -->
                    <div
                      class="absolute inset-0 flex items-center justify-between px-4 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none"
                    >
                      <div class="pointer-events-auto">
                        <button
                          v-if="game.mImageCarouselObjectIds.length > 1"
                          class="p-2 rounded-full bg-zinc-900/50 text-zinc-100 hover:bg-zinc-900/80 transition-all duration-300 hover:scale-110"
                          @click.stop="previousImage()"
                        >
                          <ChevronLeftIcon class="size-5" />
                        </button>
                      </div>
                      <div class="pointer-events-auto">
                        <button
                          v-if="game.mImageCarouselObjectIds.length > 1"
                          class="p-2 rounded-full bg-zinc-900/50 text-zinc-100 hover:bg-zinc-900/80 transition-all duration-300 hover:scale-110"
                          @click.stop="nextImage()"
                        >
                          <ChevronRightIcon class="size-5" />
                        </button>
                      </div>
                    </div>

                    <div
                      class="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none"
                    />
                    <div
                      class="absolute bottom-4 right-4 flex items-center gap-x-2 text-white opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none"
                    >
                      <ArrowsPointingOutIcon class="size-5" />
                      <span class="text-sm font-medium">{{
                        $t("store.viewFullscreen")
                      }}</span>
                    </div>
                  </div>

                  <!-- Dot navigation -->
                  <div
                    class="mt-4 flex justify-center gap-x-2"
                  >
                    <button
                      v-for="(_, index) in game.mImageCarouselObjectIds"
                      :key="index"
                      class="w-1.5 h-1.5 rounded-full transition-all"
                      :class="[
                        currentImageIndex === index
                          ? 'bg-zinc-100 scale-125'
                          : 'bg-zinc-600 hover:bg-zinc-500',
                      ]"
                      @click.stop="currentImageIndex = index"
                    />
                  </div>
                </div>

                <div
                  v-else
                  class="aspect-video rounded-lg overflow-hidden bg-zinc-900/50 flex flex-col items-center justify-center text-center px-4"
                >
                  <PhotoIcon class="size-12 text-zinc-500 mb-2" />
                  <p class="text-zinc-400 font-medium">
                    {{ $t("store.noImages") }}
                  </p>
                </div>
              </div>
            </div>

            <!-- Achievements -->
            <div class="bg-zinc-800/50 rounded-xl p-6 backdrop-blur-sm">
              <h2
                class="text-xl font-display font-semibold text-zinc-100 mb-4"
              >
                {{ $t("store.tabs.achievements") }}
              </h2>
              <div v-if="achievementsLoading" class="flex justify-center py-4">
                <div
                  class="w-5 h-5 border-2 border-zinc-600 border-t-zinc-100 rounded-full animate-spin"
                />
              </div>
              <div
                v-else-if="achievements.length === 0"
                class="flex flex-col items-center justify-center text-center py-4"
              >
                <TrophyIcon class="size-10 text-zinc-600 mb-2" />
                <p class="text-zinc-500 text-sm">
                  {{ $t("store.review.noAchievements") }}
                </p>
              </div>
              <div v-else class="space-y-2 max-h-80 overflow-y-auto custom-scrollbar pr-1">
                <!-- Progress bar -->
                <div class="flex items-center justify-between mb-2">
                  <span class="text-xs text-zinc-400">
                    {{ $t("store.review.unlockCount", { unlocked: achievementsUnlocked, total: achievements.length }) }}
                  </span>
                  <div class="flex-1 ml-3 h-1.5 bg-zinc-700 rounded-full overflow-hidden">
                    <div
                      class="h-full bg-yellow-500 rounded-full transition-all"
                      :style="{ width: `${achievements.length > 0 ? (achievementsUnlocked / achievements.length) * 100 : 0}%` }"
                    />
                  </div>
                </div>
                <!-- Achievement rows -->
                <div
                  v-for="ach in achievements"
                  :key="ach.id"
                  class="flex items-center gap-3 py-2 px-2 rounded-lg hover:bg-zinc-700/30 transition-colors"
                >
                  <img
                    v-if="ach.iconUrl && !achIconErrors[ach.id]"
                    :src="ach.iconUrl"
                    :class="[
                      'size-9 rounded shrink-0',
                      ach.unlocked ? '' : 'grayscale opacity-50',
                    ]"
                    @error="achIconErrors[ach.id] = true"
                  />
                  <div
                    v-else
                    :class="[
                      'size-9 rounded shrink-0 bg-zinc-700/50 flex items-center justify-center',
                      ach.unlocked ? '' : 'opacity-50',
                    ]"
                  >
                    <TrophyIcon class="size-5 text-zinc-500" />
                  </div>
                  <div class="flex-1 min-w-0">
                    <p
                      :class="[
                        'text-sm font-medium truncate',
                        ach.unlocked ? 'text-zinc-100' : 'text-zinc-500',
                      ]"
                    >
                      {{ ach.title }}
                    </p>
                    <p class="text-xs text-zinc-500 truncate">
                      {{ ach.description }}
                    </p>
                  </div>
                  <div v-if="ach.unlocked" class="shrink-0">
                    <CheckCircleIcon class="size-4 text-yellow-500" />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- Fullscreen image overlay -->
  <Teleport to="body">
    <div
      v-if="fullscreenImage"
      class="fixed inset-0 z-50 bg-black/90 flex items-center justify-center"
      @click="fullscreenImage = null"
    >
      <img
        :src="useObject(fullscreenImage)"
        class="max-w-full max-h-full object-contain rounded"
        @click.stop
      />
      <button
        class="absolute top-4 right-4 text-zinc-400 hover:text-zinc-100 transition-colors"
        @click="fullscreenImage = null"
      >
        <XMarkIcon class="size-8" />
      </button>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import {
  ArrowLeftIcon,
  ArrowTopRightOnSquareIcon,
  ArrowUpRightIcon,
} from "@heroicons/vue/20/solid";
import {
  StarIcon,
  ServerIcon,
  CloudIcon,
  TrophyIcon,
  CheckCircleIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ArrowsPointingOutIcon,
  PhotoIcon,
  XMarkIcon,
} from "@heroicons/vue/24/solid";
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

const { game, rating, sizes, platforms } = await $dropFetch(
  `/api/v1/games/${id}`,
);

if (!game) {
  throw createError({ statusCode: 404, message: t("library.notFound") });
}

const descriptionHTML = micromark(game.mDescription ?? "");
const averageRating = Math.round((rating._avg.mReviewRating ?? 0) * 5);
const ratingArray = Array(5)
  .fill(null)
  .map((_, i) => i + 1 <= averageRating);

// Collapsible sections
const descriptionOpen = ref(true);
const detailsOpen = ref(false);

// Image carousel
const currentImageIndex = ref(0);
const fullscreenImage = ref<string | null>(null);

function nextImage() {
  const len = game.mImageCarouselObjectIds.length;
  if (len > 0) currentImageIndex.value = (currentImageIndex.value + 1) % len;
}
function previousImage() {
  const len = game.mImageCarouselObjectIds.length;
  if (len > 0)
    currentImageIndex.value = (currentImageIndex.value - 1 + len) % len;
}

// Achievements
const achievementsLoading = ref(true);
const achievements = (await $dropFetch(
  `/api/v1/games/${id}/achievements`,
).catch(() => [])) as {
  id: string;
  title: string;
  description: string;
  iconUrl: string;
  unlocked: boolean;
  unlockedAt?: string | null;
  rarity?: number | null;
}[];
achievementsLoading.value = false;

const achievementsUnlocked = computed(
  () => achievements.filter((a) => a.unlocked).length,
);

// Track broken achievement icon URLs
const achIconErrors = reactive<Record<string, boolean>>({});

// Leaderboards
type LeaderboardMeta = {
  id: string;
  name: string;
  type: string;
  entryCount: number;
};
const leaderboards = (await $dropFetch(
  `/api/v1/games/${id}/leaderboards`,
).catch(() => [])) as LeaderboardMeta[];

// Similar games
const similarGames = ref<SerializeObject<GameModel>[]>([]);
const gameTagIds = game.tags.map((t: { id: string }) => t.id);
if (gameTagIds.length > 0) {
  const similar = await $fetch("/api/v1/store", {
    query: { take: 10, sort: "default", tags: gameTagIds.join(",") },
  }).catch(() => null);
  if (similar) {
    similarGames.value = (
      similar.results as SerializeObject<GameModel>[]
    ).filter((g: SerializeObject<GameModel>) => g.id !== id);
  }
}

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
