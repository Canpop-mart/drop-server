<template>
  <div>
    <div
      v-if="collections.length > 0"
      class="grid gap-5 grid-cols-[repeat(auto-fill,minmax(260px,1fr))]"
    >
      <NuxtLink
        v-for="c in collections"
        :key="c.id"
        :href="`/store/collection/${c.id}`"
        class="group relative block aspect-video overflow-hidden rounded-2xl ring-1 ring-white/5 transition-all duration-300 hover:shadow-xl hover:shadow-blue-500/10 hover:ring-blue-500/30"
      >
        <img
          v-if="c.coverObjectId"
          :src="useObject(c.coverObjectId)"
          :alt="c.name"
          class="size-full object-cover transition-transform duration-500 group-hover:scale-105"
        />
        <div
          v-else
          class="size-full bg-gradient-to-br from-zinc-800 to-zinc-900"
        />
        <div
          class="absolute inset-0 bg-gradient-to-t from-zinc-950/90 via-zinc-950/30 to-transparent"
        />
        <div class="absolute bottom-0 left-0 right-0 p-4">
          <h3 class="text-lg font-bold leading-tight text-white">
            {{ c.name }}
          </h3>
          <p
            v-if="c.description"
            class="mt-1 line-clamp-2 text-xs text-zinc-300"
          >
            {{ c.description }}
          </p>
          <p class="mt-1 text-[11px] text-zinc-400">
            {{ c.gameCount }} {{ c.gameCount === 1 ? "game" : "games" }}
          </p>
        </div>
      </NuxtLink>
    </div>

    <div
      v-else
      class="flex flex-col items-center justify-center gap-4 py-24 text-center"
    >
      <RectangleStackIcon class="size-16 text-zinc-700" />
      <p
        class="font-display text-xl font-bold uppercase tracking-wide text-zinc-500"
      >
        No collections yet
      </p>
      <p class="max-w-sm text-sm text-zinc-600">
        Curated game collections show up here. Create and feature one from Admin
        → Collections.
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { RectangleStackIcon } from "@heroicons/vue/24/outline";

type StoreCollection = {
  id: string;
  name: string;
  description: string | null;
  coverObjectId: string | null;
  gameCount: number;
};

const collections = ref<StoreCollection[]>(
  (await $dropFetch<StoreCollection[]>("/api/v1/store/collection").catch(
    () => [],
  )) ?? [],
);
</script>
