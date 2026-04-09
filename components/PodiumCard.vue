<template>
  <NuxtLink
    :href="`/store/${game.id}`"
    :class="heightClass"
    class="relative block w-full rounded-2xl overflow-hidden group ring-1 ring-white/10 hover:ring-blue-500/40 transition-all duration-300 hover:shadow-2xl hover:shadow-blue-500/10 hover:-translate-y-1"
  >
    <!-- Cover image -->
    <img
      :src="useObject(game.mCoverObjectId)"
      :alt="game.mName"
      class="absolute inset-0 size-full object-cover transition-transform duration-500 group-hover:scale-110"
    />

    <!-- Gradient overlay -->
    <div
      class="absolute inset-0 bg-gradient-to-t from-zinc-950 via-zinc-950/40 to-transparent"
    />

    <!-- Rank medal badge -->
    <div class="absolute top-3 left-3 z-10">
      <div
        :class="[
          medalBg,
          'flex items-center gap-1.5 px-2.5 py-1 rounded-full ring-1 backdrop-blur-sm',
        ]"
      >
        <span class="text-lg leading-none">{{ rankEmoji }}</span>
        <span :class="[medalText, 'text-xs font-bold uppercase tracking-wide']">
          {{ rankLabel }}
        </span>
      </div>
    </div>

    <!-- Content at bottom -->
    <div class="absolute bottom-0 left-0 right-0 p-4">
      <!-- Tags -->
      <div v-if="game.tags?.length" class="flex flex-wrap gap-1 mb-2">
        <span
          v-for="tag in game.tags.slice(0, 2)"
          :key="tag.id"
          class="text-[10px] px-1.5 py-0.5 rounded-full bg-white/10 text-zinc-300 backdrop-blur-sm"
        >
          {{ tag.name }}
        </span>
      </div>
      <h3
        :class="[
          rank === 1 ? 'text-lg sm:text-xl' : 'text-sm sm:text-base',
          'font-bold text-white leading-tight line-clamp-2',
        ]"
      >
        {{ game.mName }}
      </h3>
      <p
        v-if="rank === 1 && game.mShortDescription"
        class="text-zinc-400 text-xs mt-1 line-clamp-2"
      >
        {{ game.mShortDescription }}
      </p>
    </div>
  </NuxtLink>
</template>

<script setup lang="ts">
import type { SerializeObject } from "nitropack";
import type { GameModel } from "~/prisma/client/models";

const props = defineProps<{
  game: SerializeObject<GameModel> & {
    tags?: Array<{ id: string; name: string }>;
  };
  rank: number;
  medalColor: string;
  medalBg: string;
  medalText: string;
  heightClass: string;
}>();

const rankEmoji = computed(() => {
  switch (props.rank) {
    case 1:
      return "\uD83E\uDD47";
    case 2:
      return "\uD83E\uDD48";
    case 3:
      return "\uD83E\uDD49";
    default:
      return `#${props.rank}`;
  }
});

const rankLabel = computed(() => {
  switch (props.rank) {
    case 1:
      return "Most Played";
    case 2:
      return "2nd";
    case 3:
      return "3rd";
    default:
      return `${props.rank}th`;
  }
});
</script>
