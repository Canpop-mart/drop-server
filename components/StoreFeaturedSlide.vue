<template>
  <div class="relative w-full overflow-hidden bg-zinc-950 select-none">
    <!-- Blurred banner backdrop -->
    <div class="absolute inset-0 pointer-events-none">
      <img
        :src="useObject(game.mBannerObjectId)"
        aria-hidden="true"
        class="size-full object-cover object-center scale-110 blur-3xl opacity-15"
      />
      <div
        class="absolute inset-0 bg-gradient-to-r from-zinc-950 via-zinc-950/85 to-zinc-950/30"
      />
      <div
        class="absolute inset-0 bg-gradient-to-t from-zinc-950/60 to-transparent"
      />
    </div>

    <!-- Split layout -->
    <div
      class="relative max-w-7xl mx-auto px-6 sm:px-10 lg:px-16 py-14 sm:py-20 lg:py-24 flex flex-col lg:flex-row items-center gap-10 lg:gap-16"
    >
      <!-- Left: text content -->
      <div class="flex-1 min-w-0 text-left">
        <!-- Developer name -->
        <p
          v-if="developer"
          class="text-xs font-semibold uppercase tracking-widest text-blue-400 mb-3"
        >
          {{ developer }}
        </p>

        <!-- Game title -->
        <h2
          class="text-4xl sm:text-5xl lg:text-6xl font-bold text-white leading-tight"
        >
          {{ game.mName }}
        </h2>

        <!-- Short description -->
        <p
          class="mt-4 text-zinc-300 text-base sm:text-lg line-clamp-3 max-w-xl leading-relaxed"
        >
          {{ game.mShortDescription }}
        </p>

        <!-- CTA buttons -->
        <div class="mt-8 flex flex-wrap items-center gap-3">
          <NuxtLink
            :href="`/store/${game.id}`"
            class="inline-flex items-center gap-x-2 rounded-lg bg-blue-600 hover:bg-blue-500 active:bg-blue-700 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-blue-600/25 transition-all duration-200 hover:scale-[1.03] active:scale-95"
          >
            <EyeIcon class="size-4" />
            {{ $t("store.viewGame") }}
          </NuxtLink>
          <AddLibraryButton :game-id="game.id" class="!w-auto" />
        </div>
      </div>

      <!-- Right: cover art -->
      <div
        class="shrink-0 w-48 sm:w-56 lg:w-64 xl:w-72 transition-transform duration-700 hover:scale-[1.02]"
      >
        <div class="relative">
          <!-- Glow behind cover -->
          <div
            class="absolute -inset-3 bg-blue-600/20 rounded-2xl blur-xl opacity-60"
          />
          <img
            :src="useObject(game.mCoverObjectId)"
            :alt="game.mName"
            class="relative w-full aspect-[3/4] rounded-xl object-cover shadow-2xl shadow-black/70 ring-1 ring-white/10"
          />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { EyeIcon } from "@heroicons/vue/24/outline";

const props = defineProps<{
  game: {
    id: string;
    mName: string;
    mShortDescription: string;
    mCoverObjectId: string;
    mBannerObjectId: string;
    developers?: Array<{ id: string; mName: string }>;
    publishers?: Array<{ id: string; mName: string }>;
  };
}>();

const developer = computed(
  () => props.game.developers?.[0]?.mName ?? props.game.publishers?.[0]?.mName,
);
</script>
