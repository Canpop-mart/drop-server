<template>
  <div class="relative w-full h-full overflow-hidden bg-zinc-950 select-none">
    <!-- Blurred banner backdrop -->
    <div class="absolute inset-0 pointer-events-none">
      <img
        :src="useObject(game.mBannerObjectId)"
        aria-hidden="true"
        class="size-full object-cover object-center scale-110 blur-3xl opacity-40"
      />
      <div
        class="absolute inset-0 bg-gradient-to-r from-zinc-950 via-zinc-950/80 to-zinc-950/20"
      />
      <div
        class="absolute inset-0 bg-gradient-to-t from-zinc-950/70 to-transparent"
      />
    </div>

    <!-- Split layout — full-width, no max-w constraint -->
    <div
      class="relative h-full px-8 sm:px-14 lg:px-20 flex flex-col lg:flex-row items-center gap-10 lg:gap-16"
      style="
        padding-top: clamp(3rem, 8vh, 6rem);
        padding-bottom: clamp(3rem, 8vh, 6rem);
      "
    >
      <!-- Left: text content -->
      <div class="flex-1 min-w-0 text-left">
        <!-- Badge row: version + tags -->
        <div class="flex items-center flex-wrap gap-2 mb-4">
          <span
            v-if="versionLabel"
            class="text-xs font-bold px-2.5 py-1 rounded-md bg-green-700 text-white leading-tight"
          >
            {{ versionLabel }}
          </span>
          <span
            v-if="game.updateAvailable"
            class="text-xs font-bold px-2.5 py-1 rounded-md bg-orange-500 text-white leading-tight"
          >
            {{ $t("store.updateAvailable") }}
          </span>
          <span
            v-for="tag in game.tags?.slice(0, 2)"
            :key="tag.id"
            class="text-xs font-semibold px-2.5 py-1 rounded-md bg-blue-500/15 text-blue-300 border border-blue-500/25 leading-tight"
          >
            {{ tag.name }}
          </span>
        </div>

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
        class="shrink-0 w-44 sm:w-52 lg:w-60 xl:w-72 transition-transform duration-700 hover:scale-[1.02]"
      >
        <div class="relative">
          <!-- Glow behind cover -->
          <div
            class="absolute -inset-4 bg-blue-600/25 rounded-2xl blur-2xl opacity-70"
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
    tags?: Array<{ id: string; name: string }>;
    versions?: Array<{ displayName?: string | null; versionIndex?: number }>;
    updateAvailable?: boolean | null;
  };
}>();

const developer = computed(
  () => props.game.developers?.[0]?.mName ?? props.game.publishers?.[0]?.mName,
);

const versionLabel = computed(() => {
  const v = props.game.versions?.[0];
  if (!v) return null;
  return v.displayName ?? `v${v.versionIndex}`;
});
</script>
