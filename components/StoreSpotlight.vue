<template>
  <!-- Podium: top 3 most played -->
  <div v-if="items.length >= 3" class="mb-8">
    <div class="flex items-end justify-center gap-3 sm:gap-5 max-w-5xl mx-auto">
      <!-- 2nd place (Silver) — left -->
      <div class="flex-1 max-w-[280px]">
        <PodiumCard
          :game="items[1]"
          :rank="2"
          medal-color="from-zinc-300 to-zinc-400"
          medal-bg="bg-zinc-400/15 ring-zinc-400/30"
          medal-text="text-zinc-300"
          height-class="h-[340px] sm:h-[380px]"
        />
      </div>

      <!-- 1st place (Gold) — center, tallest -->
      <div class="flex-1 max-w-[320px]">
        <PodiumCard
          :game="items[0]"
          :rank="1"
          medal-color="from-yellow-400 to-amber-500"
          medal-bg="bg-yellow-500/15 ring-yellow-500/30"
          medal-text="text-yellow-400"
          height-class="h-[380px] sm:h-[440px]"
        />
      </div>

      <!-- 3rd place (Bronze) — right -->
      <div class="flex-1 max-w-[280px]">
        <PodiumCard
          :game="items[2]"
          :rank="3"
          medal-color="from-amber-600 to-orange-700"
          medal-bg="bg-amber-600/15 ring-amber-600/30"
          medal-text="text-amber-500"
          height-class="h-[340px] sm:h-[380px]"
        />
      </div>
    </div>
  </div>

  <!-- Remaining games (4th onward): horizontal row -->
  <div
    v-if="items.length > 3"
    class="grid gap-3.5"
    :style="`grid-template-columns: repeat(${Math.min(items.length - 3, 7)}, minmax(0, 1fr))`"
  >
    <GamePanel
      v-for="game in items.slice(3)"
      :key="game.id"
      :game="game"
      :href="`/store/${game.id}`"
    />
  </div>

  <!-- Skeleton while loading -->
  <div v-if="loading && items.length === 0" class="mb-8">
    <div class="flex items-end justify-center gap-3 sm:gap-5 max-w-5xl mx-auto">
      <div
        class="flex-1 max-w-[280px] h-[340px] sm:h-[380px] rounded-2xl bg-zinc-800/50 animate-pulse"
      />
      <div
        class="flex-1 max-w-[320px] h-[380px] sm:h-[440px] rounded-2xl bg-zinc-800/50 animate-pulse"
      />
      <div
        class="flex-1 max-w-[280px] h-[340px] sm:h-[380px] rounded-2xl bg-zinc-800/50 animate-pulse"
      />
    </div>
  </div>

  <!-- Fewer than 3 games fallback -->
  <div
    v-if="!loading && items.length > 0 && items.length < 3"
    class="grid grid-cols-2 sm:grid-cols-3 gap-4 max-w-3xl mx-auto"
  >
    <GamePanel
      v-for="game in items"
      :key="game.id"
      :game="game"
      :href="`/store/${game.id}`"
    />
  </div>
</template>

<script setup lang="ts">
import type { SerializeObject } from "nitropack";
import type { GameModel } from "~/prisma/client/models";

defineProps<{
  items: Array<
    SerializeObject<GameModel> & {
      tags?: Array<{ id: string; name: string }>;
    }
  >;
  loading?: boolean;
}>();
</script>
