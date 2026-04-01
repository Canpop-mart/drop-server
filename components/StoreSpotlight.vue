<template>
  <div v-if="items.length > 0" class="grid grid-cols-1 lg:grid-cols-5 gap-4">
    <!-- Large card: first/hero item -->
    <NuxtLink
      :href="`/store/${items[0].id}`"
      class="lg:col-span-3 relative rounded-xl overflow-hidden group aspect-video block ring-1 ring-white/5 hover:ring-blue-500/30 transition-all duration-300 hover:shadow-xl hover:shadow-blue-500/10"
    >
      <img
        :src="useObject(items[0].mBannerObjectId)"
        :alt="items[0].mName"
        class="size-full object-cover object-center transition-transform duration-500 group-hover:scale-105"
      />
      <!-- Gradient overlay -->
      <div
        class="absolute inset-0 bg-gradient-to-t from-zinc-950/90 via-zinc-950/30 to-transparent"
      />
      <div
        class="absolute inset-0 bg-gradient-to-r from-zinc-950/40 to-transparent"
      />
      <!-- Content at bottom -->
      <div class="absolute bottom-0 left-0 right-0 p-5">
        <!-- Tags -->
        <div v-if="items[0].tags?.length" class="flex flex-wrap gap-1.5 mb-2">
          <span
            v-for="tag in items[0].tags.slice(0, 3)"
            :key="tag.id"
            class="text-xs px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-300 border border-blue-500/25 backdrop-blur-sm"
          >
            {{ tag.name }}
          </span>
        </div>
        <h3 class="text-2xl font-bold text-white leading-tight">
          {{ items[0].mName }}
        </h3>
        <p class="text-zinc-300 text-sm mt-1 line-clamp-2 max-w-sm">
          {{ items[0].mShortDescription }}
        </p>
      </div>
    </NuxtLink>

    <!-- Small cards: 2x2 grid -->
    <div class="lg:col-span-2 grid grid-cols-2 gap-4">
      <template v-if="loading">
        <div
          v-for="i in 4"
          :key="i"
          class="aspect-[3/4] rounded-xl bg-zinc-800/50 animate-pulse"
        />
      </template>
      <template v-else>
        <NuxtLink
          v-for="game in items.slice(1, 5)"
          :key="game.id"
          :href="`/store/${game.id}`"
          class="relative rounded-xl overflow-hidden group aspect-[3/4] block ring-1 ring-white/5 hover:ring-blue-500/30 transition-all duration-300 hover:shadow-lg hover:shadow-blue-500/10 hover:-translate-y-0.5"
        >
          <img
            :src="useObject(game.mCoverObjectId)"
            :alt="game.mName"
            class="size-full object-cover transition-transform duration-[400ms] group-hover:scale-110"
          />
          <div
            class="absolute inset-0 bg-gradient-to-t from-zinc-950/80 via-transparent to-transparent"
          />
          <div class="absolute bottom-0 left-0 right-0 p-2.5">
            <p
              class="text-xs font-semibold text-white leading-tight line-clamp-2"
            >
              {{ game.mName }}
            </p>
          </div>
        </NuxtLink>
      </template>
    </div>
  </div>

  <!-- Skeleton for large card while loading -->
  <div v-else-if="loading" class="grid grid-cols-1 lg:grid-cols-5 gap-4">
    <div
      class="lg:col-span-3 aspect-video rounded-xl bg-zinc-800/50 animate-pulse"
    />
    <div class="lg:col-span-2 grid grid-cols-2 gap-4">
      <div
        v-for="i in 4"
        :key="i"
        class="aspect-[3/4] rounded-xl bg-zinc-800/50 animate-pulse"
      />
    </div>
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
