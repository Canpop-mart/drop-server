<template>
  <div class="w-full flex flex-col overflow-x-hidden">
    <!-- ─── Hero carousel ───────────────────────────────────────── -->
    <div
      class="relative overflow-hidden bg-zinc-950"
      style="height: calc(100vh - 54px); min-height: 560px"
    >
      <VueCarousel
        v-if="featured.length > 0"
        v-model="heroSlide"
        :wrap-around="true"
        :items-to-show="1"
        :transition="600"
        :autoplay="0"
        class="hero-carousel"
        style="height: 100%"
      >
        <VueSlide v-for="game in featured" :key="game.id">
          <StoreFeaturedSlide :game="game" />
        </VueSlide>

        <template #addons>
          <div
            class="absolute bottom-5 left-0 right-0 flex justify-center z-10"
          >
            <CarouselPagination />
          </div>
        </template>
      </VueCarousel>

      <!-- Empty hero fallback -->
      <div
        v-else
        class="absolute inset-0 flex flex-col items-center justify-center bg-zinc-950 px-6 gap-4"
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

      <!-- Blue progress bar at bottom edge of hero -->
      <div
        v-if="featured.length > 1"
        class="absolute bottom-0 left-0 right-0 h-[3px] bg-zinc-800/60 z-20 pointer-events-none"
      >
        <div
          class="h-full bg-blue-500"
          :style="{
            width: progressPercent + '%',
            transition: progressTransition,
          }"
        />
      </div>
    </div>

    <!-- ─── Tab nav ───────────────────────────────────────────────── -->
    <div
      class="sticky top-[54px] z-30 w-full bg-zinc-950/90 backdrop-blur-md border-b border-zinc-800/60 shadow-lg shadow-black/20"
    >
      <div class="px-4 sm:px-8 flex items-center gap-1 h-14">
        <button
          v-for="tab in tabs"
          :key="tab.id"
          :class="
            activeTab === tab.id
              ? 'text-white bg-blue-500/15'
              : 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/60'
          "
          class="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors duration-150 cursor-pointer"
          @click="activeTab = tab.id"
        >
          <component :is="tab.icon" class="size-4 shrink-0" />
          {{ tab.label }}
        </button>
      </div>
    </div>

    <!-- ─── Tab panels ─────────────────────────────────────────────── -->
    <div class="px-4 sm:px-8 py-8 min-h-[60vh]">
      <!-- Most Played -->
      <section v-show="activeTab === 'mostPlayed'">
        <StoreSpotlight :items="trendingGames" :loading="trendingLoading" />
        <!-- Empty state -->
        <div
          v-if="!trendingLoading && trendingGames.length === 0"
          class="flex flex-col items-center justify-center py-24 gap-4 text-center"
        >
          <FireIcon class="size-16 text-zinc-700" />
          <p
            class="text-xl font-bold text-zinc-500 font-display uppercase tracking-wide"
          >
            {{ $t("store.mostPlayedEmpty") }}
          </p>
          <p class="text-sm text-zinc-600 max-w-sm">
            {{ $t("store.mostPlayedEmptySub") }}
          </p>
        </div>
      </section>

      <!-- Recently Added -->
      <section v-show="activeTab === 'recentlyAdded'">
        <!-- Skeleton -->
        <div v-if="recentlyAddedLoading" class="space-y-4">
          <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div
              class="aspect-video rounded-2xl bg-zinc-800/50 animate-pulse"
            />
            <div class="grid grid-cols-2 gap-4">
              <div
                v-for="i in 2"
                :key="i"
                class="aspect-[2/3] rounded-xl bg-zinc-800/50 animate-pulse"
              />
            </div>
          </div>
          <div class="grid grid-cols-6 gap-3.5">
            <div
              v-for="i in 12"
              :key="i"
              class="aspect-[2/3] rounded-xl bg-zinc-800/50 animate-pulse"
            />
          </div>
        </div>

        <div v-else-if="recentlyAdded.length > 0" class="space-y-6">
          <!-- Hero row: newest game large + 2 medium cards, matched height -->
          <div
            class="grid grid-cols-1 lg:grid-cols-5 gap-4"
            style="--hero-h: 420px"
          >
            <!-- Newest game — hero banner card -->
            <NuxtLink
              :href="`/store/${recentlyAdded[0].id}`"
              class="lg:col-span-3 relative rounded-2xl overflow-hidden group block ring-1 ring-white/5 hover:ring-blue-500/30 transition-all duration-300 hover:shadow-xl hover:shadow-blue-500/10"
              style="height: var(--hero-h)"
            >
              <img
                :src="useObject(recentlyAdded[0].mBannerObjectId)"
                :alt="recentlyAdded[0].mName"
                class="size-full object-cover object-center transition-transform duration-500 group-hover:scale-105"
              />
              <div
                class="absolute inset-0 bg-gradient-to-t from-zinc-950/90 via-zinc-950/30 to-transparent"
              />
              <div class="absolute top-3 left-3">
                <span
                  class="text-[10px] font-bold uppercase tracking-widest px-2.5 py-1 rounded-full bg-blue-500/20 text-blue-300 ring-1 ring-blue-500/30 backdrop-blur-sm"
                >
                  Just Added
                </span>
              </div>
              <div class="absolute bottom-0 left-0 right-0 p-5">
                <h3 class="text-2xl font-bold text-white leading-tight">
                  {{ recentlyAdded[0].mName }}
                </h3>
                <p class="text-zinc-300 text-sm mt-1 line-clamp-2 max-w-md">
                  {{ recentlyAdded[0].mShortDescription }}
                </p>
              </div>
            </NuxtLink>

            <!-- Next 2 games — tall cover cards, same height as hero -->
            <div
              v-if="recentlyAdded.length > 1"
              class="lg:col-span-2 grid grid-cols-2 gap-4"
              style="height: var(--hero-h)"
            >
              <NuxtLink
                v-for="game in recentlyAdded.slice(1, 3)"
                :key="game.id"
                :href="`/store/${game.id}`"
                class="relative rounded-xl overflow-hidden group block h-full ring-1 ring-white/5 hover:ring-blue-500/30 transition-all duration-300 hover:shadow-lg hover:shadow-blue-500/10 hover:-translate-y-0.5"
              >
                <img
                  :src="useObject(game.mCoverObjectId)"
                  :alt="game.mName"
                  class="size-full object-cover transition-transform duration-[400ms] group-hover:scale-110"
                />
                <div
                  class="absolute inset-0 bg-gradient-to-t from-zinc-950/80 via-transparent to-transparent"
                />
                <div class="absolute top-2 left-2">
                  <span
                    class="text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-blue-500/15 text-blue-300/80 ring-1 ring-blue-500/20 backdrop-blur-sm"
                  >
                    New
                  </span>
                </div>
                <div class="absolute bottom-0 left-0 right-0 p-2.5">
                  <p
                    class="text-xs font-semibold text-white leading-tight line-clamp-2"
                  >
                    {{ game.mName }}
                  </p>
                </div>
              </NuxtLink>
            </div>
          </div>

          <!-- Rest of the recently added games — single row -->
          <div
            v-if="recentlyAdded.length > 3"
            class="grid gap-3.5"
            :style="`grid-template-columns: repeat(${recentlyAddedRowCount}, minmax(0, 1fr))`"
          >
            <GamePanel
              v-for="game in recentlyAdded.slice(3, 3 + recentlyAddedRowCount)"
              :key="game.id"
              :game="game"
              :href="`/store/${game.id}`"
            />
          </div>
        </div>
      </section>

      <!-- Browse All -->
      <section v-if="tabMounted.browse" v-show="activeTab === 'browse'">
        <StoreView />
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import {
  ArrowTopRightOnSquareIcon,
  FireIcon,
  ClockIcon,
  Squares2X2Icon,
} from "@heroicons/vue/24/outline";
import type { SerializeObject } from "nitropack";
import type { GameModel } from "~/prisma/client/models";

type StoreGame = SerializeObject<GameModel>;
type TrendingGame = StoreGame & {
  tags?: Array<{ id: string; name: string }>;
};

const featured = await $dropFetch("/api/v1/store/featured");
const user = useUser();
const { t } = useI18n();

useHead({ title: t("store.title") });

// ─── Tabs ─────────────────────────────────────────────────────────────
const activeTab = ref<"mostPlayed" | "recentlyAdded" | "browse">("mostPlayed");
const tabMounted = reactive<Record<string, boolean>>({
  mostPlayed: true,
  recentlyAdded: true,
  browse: false,
});

watch(activeTab, (tab) => {
  tabMounted[tab] = true;
});

const tabs = computed(() => [
  {
    id: "mostPlayed" as const,
    label: t("store.nav.mostPlayed"),
    icon: FireIcon,
  },
  {
    id: "recentlyAdded" as const,
    label: t("store.nav.new"),
    icon: ClockIcon,
  },
  {
    id: "browse" as const,
    label: t("store.nav.browse"),
    icon: Squares2X2Icon,
  },
]);

// ─── Hero progress bar ────────────────────────────────────────────────
const SLIDE_MS = 10_000;
const heroSlide = ref(0);
const progressPercent = ref(0);
const progressTransition = ref<string>("none");
let slideTimer: ReturnType<typeof setTimeout> | null = null;

function startProgress() {
  if (slideTimer) {
    clearTimeout(slideTimer);
    slideTimer = null;
  }
  // Reset transition + width immediately
  progressTransition.value = "none";
  progressPercent.value = 0;
  // Double rAF ensures the browser paints the reset before re-triggering
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      progressTransition.value = `width ${SLIDE_MS}ms linear`;
      progressPercent.value = 100;
      slideTimer = setTimeout(() => {
        heroSlide.value = (heroSlide.value + 1) % featured.length;
      }, SLIDE_MS);
    });
  });
}

watch(heroSlide, () => {
  if (featured.length > 1) startProgress();
});

onMounted(() => {
  if (featured.length > 1) startProgress();
});

onUnmounted(() => {
  if (slideTimer) clearTimeout(slideTimer);
});

// ─── Data fetching ────────────────────────────────────────────────────
const trendingLoading = ref(true);
const trendingGames = ref<TrendingGame[]>([]);
$fetch<{ results: TrendingGame[] }>("/api/v1/store/trending", {
  query: { take: 10, days: 7 },
})
  .then((data) => {
    trendingGames.value = data.results;
  })
  .catch(() => {})
  .finally(() => {
    trendingLoading.value = false;
  });

// How many games fit in a single row after the hero (approximation based on common widths)
const recentlyAddedRowCount = 9;

const recentlyAddedLoading = ref(true);
const recentlyAdded = ref<StoreGame[]>([]);
$fetch<{ results: StoreGame[] }>("/api/v1/store", {
  query: { take: 3 + recentlyAddedRowCount, sort: "recent", order: "desc" },
})
  .then((data) => {
    recentlyAdded.value = data.results;
  })
  .catch(() => {})
  .finally(() => {
    recentlyAddedLoading.value = false;
  });
</script>

<style scoped>
:deep(.hero-carousel .carousel__viewport),
:deep(.hero-carousel .carousel__track),
:deep(.hero-carousel .carousel__slide) {
  height: 100%;
}
/* Override the global overflow:visible rule for the hero carousel */
:deep(.hero-carousel > .carousel__viewport) {
  overflow: hidden !important;
}
</style>
