<template>
  <div class="w-full flex flex-col overflow-x-hidden">
    <!-- ─── Hero carousel ───────────────────────────────────────── -->
    <VueCarousel
      v-if="featured.length > 0"
      :wrap-around="true"
      :items-to-show="1"
      :autoplay="15 * 1000"
      :transition="600"
      :pause-autoplay-on-hover="true"
      class="store-carousel"
    >
      <VueSlide v-for="game in featured" :key="game.id">
        <StoreFeaturedSlide :game="game" />
      </VueSlide>

      <template #addons>
        <CarouselPagination class="py-2" :items="featured" />
      </template>
    </VueCarousel>

    <!-- Empty hero fallback -->
    <div
      v-else
      class="w-full flex flex-col items-center justify-center bg-zinc-950/50 px-6 py-32 gap-4"
    >
      <h2
        class="uppercase text-xl font-bold tracking-tight text-zinc-700 sm:text-3xl"
      >
        {{ $t("store.noFeatured") }}
      </h2>
      <NuxtLink
        v-if="user?.admin"
        to="/admin/library"
        class="inline-flex items-center gap-x-2 rounded-md bg-zinc-800 px-3 py-1 text-sm font-semibold text-white shadow-sm hover:bg-zinc-700 duration-200 hover:scale-105 active:scale-95"
      >
        <i18n-t
          keypath="store.openFeatured"
          tag="span"
          scope="global"
          class="inline-flex items-center gap-x-1"
        >
          <template #arrow>
            <ArrowTopRightOnSquareIcon class="size-4" />
          </template>
        </i18n-t>
      </NuxtLink>
    </div>

    <!-- ─── Sticky category nav + search ──────────────────────── -->
    <div
      class="sticky top-0 z-30 w-full bg-zinc-950/90 backdrop-blur-md border-b border-zinc-800/60 shadow-lg shadow-black/20"
    >
      <div class="max-w-7xl mx-auto px-4 sm:px-8 flex items-center gap-6 h-14">
        <!-- Category tabs -->
        <nav class="hidden sm:flex items-center gap-1 shrink-0">
          <a
            v-for="cat in categories"
            :key="cat.anchor"
            :href="`#${cat.anchor}`"
            class="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/60 transition-colors duration-150"
          >
            <component :is="cat.icon" class="size-4 shrink-0" />
            {{ cat.label }}
          </a>
        </nav>

        <!-- Divider -->
        <div class="hidden sm:block h-5 w-px bg-zinc-700/60 shrink-0" />

        <!-- Search bar -->
        <div class="flex-1 min-w-0">
          <StoreSearch />
        </div>
      </div>
    </div>

    <!-- ─── Discovery sections ─────────────────────────────────── -->
    <div
      class="max-w-7xl mx-auto w-full px-4 sm:px-8 py-10 flex flex-col gap-y-14"
    >
      <!-- Trending: spotlight layout (1 big + 4 small) -->
      <section id="trending">
        <div class="flex items-center justify-between px-1 mb-5">
          <div class="flex items-center gap-x-3">
            <div class="w-1 h-5 rounded-full bg-blue-500 shrink-0" />
            <FireIcon class="size-5 text-blue-400" />
            <h2 class="text-xl font-bold font-display text-zinc-100">
              {{ $t("store.sections.trending") }}
            </h2>
          </div>
        </div>
        <p class="text-sm text-zinc-500 px-1 -mt-3 mb-4">
          {{ $t("store.sections.trendingSub") }}
        </p>
        <StoreSpotlight :items="trendingGames" :loading="trendingLoading" />
      </section>

      <!-- Most Popular -->
      <section id="popular">
        <StoreSection
          :title="$t('store.sections.popular')"
          :subtitle="$t('store.sections.popularSub')"
          :icon="ChartBarIcon"
          :items="popularGames"
          :loading="popularLoading"
        />
      </section>

      <!-- Recommended -->
      <section v-if="user" id="recommended">
        <StoreSection
          :title="$t('store.sections.recommended')"
          :subtitle="$t('store.sections.recommendedSub')"
          :icon="SparklesIcon"
          :items="recommendedGames"
          :loading="recommendedLoading"
        />
      </section>

      <!-- Recently Added -->
      <section id="new">
        <StoreSection
          :title="$t('store.sections.recentlyAdded')"
          :icon="ClockIcon"
          :items="recentlyAdded"
          :loading="recentlyAddedLoading"
        />
      </section>
    </div>

    <!-- ─── Full store browser ─────────────────────────────────── -->
    <div id="browse" class="border-t border-zinc-800/50">
      <StoreView />
    </div>
  </div>
</template>

<script setup lang="ts">
import {
  ArrowTopRightOnSquareIcon,
  FireIcon,
  ChartBarIcon,
  SparklesIcon,
  ClockIcon,
  TagIcon,
  Squares2X2Icon,
} from "@heroicons/vue/24/outline";
import type { SerializeObject } from "nitropack";
import type { GameModel } from "~/prisma/client/models";

type StoreGame = SerializeObject<GameModel>;
type TrendingGame = StoreGame & {
  tags?: Array<{ id: string; name: string }>;
  recentPlayers?: number;
};

const featured = await $dropFetch("/api/v1/store/featured");
const user = useUser();
const { t } = useI18n();

useHead({ title: t("store.title") });

const categories = computed(() => [
  { label: t("store.nav.trending"), anchor: "trending", icon: FireIcon },
  { label: t("store.nav.popular"), anchor: "popular", icon: ChartBarIcon },
  ...(user.value
    ? [
        {
          label: t("store.nav.recommended"),
          anchor: "recommended",
          icon: SparklesIcon,
        },
      ]
    : []),
  { label: t("store.nav.new"), anchor: "new", icon: ClockIcon },
  { label: t("store.nav.browse"), anchor: "browse", icon: Squares2X2Icon },
]);

// Trending
const trendingLoading = ref(true);
const trendingGames = ref<TrendingGame[]>([]);
$fetch("/api/v1/store/trending", { query: { take: 10, days: 7 } })
  .then((data) => {
    trendingGames.value = data.results as unknown as TrendingGame[];
  })
  .catch(() => {})
  .finally(() => {
    trendingLoading.value = false;
  });

// Popular
const popularLoading = ref(true);
const popularGames = ref<StoreGame[]>([]);
$fetch("/api/v1/store/popular", { query: { take: 10 } })
  .then((data) => {
    popularGames.value = data.results as unknown as StoreGame[];
  })
  .catch(() => {})
  .finally(() => {
    popularLoading.value = false;
  });

// Recommended
const recommendedLoading = ref(true);
const recommendedGames = ref<StoreGame[]>([]);
if (user.value) {
  $fetch("/api/v1/store/recommended", { query: { take: 10 } })
    .then((data) => {
      recommendedGames.value = data.results as unknown as StoreGame[];
    })
    .catch(() => {})
    .finally(() => {
      recommendedLoading.value = false;
    });
} else {
  recommendedLoading.value = false;
}

// Recently Added
const recentlyAddedLoading = ref(true);
const recentlyAdded = ref<StoreGame[]>([]);
$fetch("/api/v1/store", { query: { take: 10, sort: "recent", order: "desc" } })
  .then((data) => {
    recentlyAdded.value = data.results as unknown as StoreGame[];
  })
  .catch(() => {})
  .finally(() => {
    recentlyAddedLoading.value = false;
  });
</script>
