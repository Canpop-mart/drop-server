<!-- eslint-disable vue/no-v-html -->
<template>
  <div
    class="mx-auto bg-zinc-950 w-full relative flex flex-col justify-center pt-32 xl:pt-24 z-10 overflow-hidden"
  >
    <!-- banner image -->
    <div class="absolute flex top-0 h-fit inset-x-0 h-12 -z-[20] pb-4">
      <img
        :src="useObject(game.mBannerObjectId)"
        class="blur-sm w-full h-auto"
      />
      <div
        class="absolute inset-0 bg-gradient-to-b from-transparent to-80% to-zinc-950"
      />
    </div>
    <!-- main page -->
    <div
      :class="[
        'max-w-7xl w-full min-h-screen mx-auto px-5 py-4 sm:px-16 sm:py-12 rounded-xl', // layout stuff
        'bg-zinc-950/90 backdrop-blur-[500px] backdrop-saturate-200 backdrop-brightness-200', // make a soft, colourful glow background
      ]"
    >
      <h1
        class="text-3xl md:text-5xl font-bold font-display text-zinc-100 pb-4 border-b border-zinc-800"
      >
        {{ game.mName }}
      </h1>

      <div class="mt-8 grid grid-cols-1 lg:grid-cols-4 gap-10">
        <div
          class="col-start-1 lg:col-start-4 flex flex-col gap-y-6 items-center"
        >
          <img
            class="transition-all duration-300 hover:scale-105 hover:rotate-[-1deg] w-64 h-auto rounded gameCover"
            :src="useObject(game.mCoverObjectId)"
            :alt="game.mName"
          />
          <div class="flex items-center gap-x-2">
            <AddLibraryButton :game-id="game.id" />
          </div>
          <NuxtLink
            v-if="user?.admin && !isClient"
            :href="`/admin/library/${game.id}`"
            type="button"
            class="inline-flex items-center gap-x-2 rounded-md bg-zinc-800 px-3 py-1 text-sm font-semibold font-display text-white shadow-sm hover:bg-zinc-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 duration-200 hover:scale-105 active:scale-95"
          >
            {{ $t("store.openAdminDashboard") }}
            <ArrowTopRightOnSquareIcon
              class="-mr-0.5 h-7 w-7 p-1"
              aria-hidden="true"
            />
          </NuxtLink>
          <table class="min-w-full">
            <tbody>
              <tr>
                <td
                  class="whitespace-nowrap py-4 pl-4 pr-3 text-sm font-medium text-zinc-100 sm:pl-3"
                >
                  {{ $t("store.released") }}
                </td>
                <td class="whitespace-nowrap px-3 py-4 text-sm text-zinc-400">
                  <time datetime="game.mReleased">
                    {{ $d(new Date(game.mReleased), "short") }}
                  </time>
                </td>
              </tr>
              <tr>
                <td
                  class="whitespace-nowrap py-4 pl-4 pr-3 text-sm font-medium text-zinc-100 sm:pl-3"
                >
                  {{ $t("store.platform", platforms.length) }}
                </td>
                <td
                  class="whitespace-nowrap inline-flex gap-x-4 px-3 py-4 text-sm text-zinc-400"
                >
                  <component
                    :is="PLATFORM_ICONS[platform]"
                    v-for="platform in platforms"
                    :key="platform"
                    class="text-blue-600 w-6 h-6"
                  />
                  <span
                    v-if="platforms.length == 0"
                    class="font-semibold text-blue-600"
                    >{{ $t("store.commingSoon") }}</span
                  >
                </td>
              </tr>
              <tr>
                <td
                  class="whitespace-nowrap py-4 pl-4 pr-3 text-sm font-medium text-zinc-100 sm:pl-3"
                >
                  {{ $t("store.size") }}
                </td>
                <td
                  v-if="sizes.length > 0"
                  class="whitespace-nowrap inline-flex gap-x-4 px-3 py-4 text-sm text-zinc-400"
                >
                  <ul class="flex flex-col">
                    <ol
                      v-for="version in sizes"
                      :key="version.versionId"
                      class="inline-flex items-center gap-x-1"
                    >
                      <ServerIcon class="size-4" />
                      {{
                        formatBytes(version.installSize)
                      }}

                      <CloudIcon class="size-4 ml-3" />
                      {{
                        formatBytes(version.downloadSize)
                      }}
                    </ol>
                  </ul>
                </td>
                <td
                  v-else
                  class="whitespace-nowrap inline-flex gap-x-4 px-3 py-4 text-sm text-zinc-400"
                >
                  <span class="font-semibold text-blue-600">{{
                    $t("store.commingSoon")
                  }}</span>
                </td>
              </tr>
              <tr>
                <td
                  class="whitespace-nowrap py-4 pl-4 pr-3 text-sm font-medium text-zinc-100 sm:pl-3"
                >
                  {{ $t("store.rating") }}
                </td>
                <td
                  class="whitespace-nowrap flex flex-row items-center gap-x-1 px-3 py-4 text-sm text-zinc-400"
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
                    $t("store.reviews", [$n(rating._sum.mReviewCount ?? 0)])
                  }}</span>
                </td>
              </tr>
              <tr>
                <td
                  class="whitespace-nowrap align-top py-4 pl-4 pr-3 text-sm font-medium text-zinc-100 sm:pl-3"
                >
                  {{ $t("store.tags") }}
                </td>
                <td class="flex flex-col gap-1 px-3 py-4 text-sm text-zinc-400">
                  <NuxtLink
                    v-for="tag in game.tags"
                    :key="tag.id"
                    :href="`/store/t/${tag.id}`"
                    class="w-min hover:underline hover:text-zinc-100 whitespace-nowrap"
                  >
                    {{ tag.name }}
                  </NuxtLink>
                  <span
                    v-if="game.tags.length == 0"
                    class="text-zinc-700 font-bold uppercase font-display"
                    >{{ $t("store.noTags") }}</span
                  >
                </td>
              </tr>
              <tr>
                <td
                  class="whitespace-nowrap align-top py-4 pl-4 pr-3 text-sm font-medium text-zinc-100 sm:pl-3"
                >
                  {{ $t("store.developers", game.developers.length) }}
                </td>
                <td class="flex flex-col px-3 py-4 text-sm text-zinc-400">
                  <NuxtLink
                    v-for="developer in game.developers"
                    :key="developer.id"
                    :href="`/store/c/${developer.id}`"
                    class="w-min hover:underline hover:text-zinc-100 whitespace-nowrap"
                  >
                    {{ developer.mName }}
                  </NuxtLink>
                  <span
                    v-if="game.developers.length == 0"
                    class="text-zinc-700 font-bold uppercase font-display"
                    >{{ $t("store.noDevelopers") }}</span
                  >
                </td>
              </tr>
              <tr>
                <td
                  class="whitespace-nowrap align-top py-4 pl-4 pr-3 text-sm font-medium text-zinc-100 sm:pl-3"
                >
                  {{ $t("store.publishers", game.publishers.length) }}
                </td>
                <td class="flex flex-col px-3 py-4 text-sm text-zinc-400">
                  <NuxtLink
                    v-for="publisher in game.publishers"
                    :key="publisher.id"
                    :href="`/store/c/${publisher.id}`"
                    class="w-min hover:underline hover:text-zinc-100 whitespace-nowrap"
                  >
                    {{ publisher.mName }}
                  </NuxtLink>
                  <span
                    v-if="game.publishers.length == 0"
                    class="text-zinc-700 font-bold uppercase font-display"
                    >{{ $t("store.noPublishers") }}</span
                  >
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div class="row-start-2 lg:row-start-1 lg:col-span-3">
          <p class="text-lg text-zinc-400">
            {{ game.mShortDescription }}
          </p>
          <div class="mt-6 py-4 rounded">
            <VueCarousel :items-to-show="1" :wrap-around="true">
              <VueSlide
                v-for="image in game.mImageCarouselObjectIds"
                :key="image"
              >
                <img
                  class="w-fit h-48 lg:h-96 rounded"
                  :src="useObject(image)"
                />
              </VueSlide>
              <VueSlide v-if="game.mImageCarouselObjectIds.length == 0">
                <div
                  class="h-48 lg:h-96 aspect-[1/2] flex items-center justify-center text-zinc-700 font-bold font-display"
                >
                  {{ $t("store.noImages") }}
                </div>
              </VueSlide>

              <template #addons>
                <VueNavigation />
                <CarouselPagination class="py-2 px-12" />
              </template>
            </VueCarousel>
          </div>

          <div>
            <div
              class="mt-12 prose prose-invert prose-blue max-w-none"
              v-html="descriptionHTML"
            />
          </div>

          <!-- Tabs Section -->
          <div class="mt-12">
            <div class="border-b border-zinc-700 mb-4">
              <nav class="flex gap-4">
                <button
                  v-for="tab in tabs"
                  :key="tab"
                  @click="activeTab = tab"
                  :class="[
                    activeTab === tab
                      ? 'border-blue-400 text-blue-400'
                      : 'border-transparent text-zinc-400 hover:text-zinc-200',
                    'pb-2 px-1 border-b-2 text-sm font-medium',
                  ]"
                >
                  {{ $t("store.tabs." + tab.toLowerCase()) }}
                </button>
              </nav>
            </div>
            <!-- Achievements Tab -->
            <div v-if="activeTab === 'Achievements'">
              <div v-if="achievementsLoading" class="text-zinc-500">
                {{ $t("common.srLoading") }}
              </div>
              <div
                v-else-if="achievements?.length === 0"
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
            <!-- Reviews Tab -->
            <div v-if="activeTab === 'Reviews'">
              <div class="mb-6 p-4 bg-zinc-800/50 rounded-lg">
                <div class="flex items-center gap-4">
                  <div class="text-3xl font-bold text-blue-400">
                    {{
                      reviewStats?.averageRating
                        ? reviewStats.averageRating.toFixed(1)
                        : "—"
                    }}
                  </div>
                  <StarRating
                    :model-value="Math.round(reviewStats?.averageRating || 0)"
                  />
                  <span class="text-zinc-400 text-sm"
                    >({{ reviewStats?.totalReviews || 0 }} reviews)</span
                  >
                </div>
              </div>
              <div v-if="user" class="mb-6 p-4 bg-zinc-800/30 rounded-lg">
                <h3 class="text-sm font-medium text-zinc-200 mb-2">
                  {{ $t("store.review.write") }}
                </h3>
                <StarRating v-model="newReviewRating" :interactive="true" />
                <textarea
                  v-model="newReviewBody"
                  :placeholder="$t('store.review.placeholder')"
                  class="mt-2 w-full p-2 rounded bg-zinc-900 border border-zinc-700 text-sm text-zinc-200 placeholder-zinc-500 resize-none h-20"
                />
                <button
                  class="mt-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded text-sm text-white"
                  @click="submitReview"
                >
                  {{ $t("store.review.submit") }}
                </button>
              </div>
              <div class="space-y-3">
                <ReviewCard v-for="r in reviews" :key="r.id" :review="r" />
                <p
                  v-if="!reviews?.length"
                  class="text-zinc-500 text-center py-8"
                >
                  {{ $t("store.review.noReviews") }}
                </p>
              </div>
            </div>
            <!-- Similar Games Tab -->
            <div v-if="activeTab === 'Similar'">
              <div v-if="similarLoading" class="text-zinc-500">
                {{ $t("common.srLoading") }}
              </div>
              <div
                v-else-if="similarGames.length === 0"
                class="text-zinc-500 text-center py-8"
              >
                {{ $t("store.review.noSimilar") }}
              </div>
              <GameCarousel v-else :items="similarGames" />
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ArrowTopRightOnSquareIcon } from "@heroicons/vue/24/outline";
import { StarIcon, ServerIcon, CloudIcon } from "@heroicons/vue/24/solid";
import type { SerializeObject } from "nitropack";
import type { GameModel } from "~/prisma/client/models";
import { micromark } from "micromark";
import { formatBytes } from "~/server/internal/utils/files";

const route = useRoute();
const gameId = route.params.id.toString();
const user = useUser();
const { game, rating, sizes, platforms } = await $dropFetch(
  `/api/v1/games/${gameId}`,
);
const isClient = isClientRequest();
const descriptionHTML = micromark(game.mDescription);
const averageRating = Math.round((rating._avg.mReviewRating ?? 0) * 5);
const ratingArray = Array(5)
  .fill(null)
  .map((_, i) => i + 1 <= averageRating);

const tabs = ["Achievements", "Reviews", "Similar"];
const activeTab = ref("Achievements");
const achievementsLoading = ref(true);
const similarLoading = ref(true);
const achievements = await $dropFetch(
  `/api/v1/games/${gameId}/achievements`,
).catch(() => []);
achievementsLoading.value = false;

interface ReviewData {
  stats: { averageRating: number; totalReviews: number };
  reviews: Array<{
    id: string;
    rating: number;
    body: string;
    createdAt: Date;
    user: {
      profilePictureObjectId: string;
      displayName: string;
      username: string;
    };
  }>;
}

const reviewStats = ref<ReviewData["stats"] | null>(null);
const reviews = ref<ReviewData["reviews"]>([]);
const reviewData = (await $dropFetch(`/api/v1/games/${gameId}/reviews`).catch(
  () => null,
)) as ReviewData | null;
if (reviewData) {
  reviewStats.value = reviewData.stats;
  reviews.value = reviewData.reviews;
}

// Similar games based on shared tags
const similarGames = ref<SerializeObject<GameModel>[]>([]);
const gameTagIds = game.tags.map((t: { id: string }) => t.id);
if (gameTagIds.length > 0) {
  const similar = await $fetch("/api/v1/store", {
    query: { take: 10, sort: "default", tags: gameTagIds.join(",") },
  }).catch(() => null);
  if (similar) {
    similarGames.value = (
      similar.results as SerializeObject<GameModel>[]
    ).filter((g: SerializeObject<GameModel>) => g.id !== gameId);
  }
}
similarLoading.value = false;

const newReviewRating = ref(3);
const newReviewBody = ref("");
const submitReview = async () => {
  await $dropFetch(`/api/v1/games/${gameId}/reviews`, {
    method: "POST",
    body: { rating: newReviewRating.value, body: newReviewBody.value },
  });
  const refreshed = (await $dropFetch(`/api/v1/games/${gameId}/reviews`).catch(
    () => null,
  )) as ReviewData | null;
  if (refreshed) {
    reviewStats.value = refreshed.stats;
    reviews.value = refreshed.reviews;
  }
  newReviewBody.value = "";
};

useHead({ title: game.mName });
</script>

<style scoped>
h1 {
  view-transition-name: header;
}
img.gameCover {
  view-transition-name: selected-game;
}
</style>

<style>
::view-transition-old(header),
::view-transition-new(header) {
  width: auto;
}
</style>
