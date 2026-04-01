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
        class="hero-carousel h-full relative"
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
      </section>

      <!-- Recently Added: 2-row × 7-col grid -->
      <section v-show="activeTab === 'recentlyAdded'">
        <div v-if="recentlyAddedLoading" class="grid grid-cols-7 gap-3.5">
          <div
            v-for="i in 14"
            :key="i"
            class="aspect-[2/3] rounded-xl bg-zinc-800/50 animate-pulse"
          />
        </div>
        <div v-else class="grid grid-cols-7 gap-3.5">
          <GamePanel
            v-for="game in recentlyAdded.slice(0, 14)"
            :key="game.id"
            :game="game"
            :href="`/store/${game.id}`"
          />
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
const SLIDE_MS = 6000;
const heroSlide = ref(0);
const progressPercent = ref(0);
const progressTransition = ref<string>("none");
let slideTimer: ReturnType<typeof setTimeout> | null = null;

function startProgress() {
  if (slideTimer) {
    clearTimeout(slideTimer);
    slideTimer = null;
  }
  progressTransition.value = "none";
  progressPercent.value = 0;
  nextTick(() => {
    progressTransition.value = `width ${SLIDE_MS}ms linear`;
    progressPercent.value = 100;
    slideTimer = setTimeout(() => {
      heroSlide.value = (heroSlide.value + 1) % featured.length;
    }, SLIDE_MS);
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

const recentlyAddedLoading = ref(true);
const recentlyAdded = ref<StoreGame[]>([]);
$fetch<{ results: StoreGame[] }>("/api/v1/store", {
  query: { take: 14, sort: "recent", order: "desc" },
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
