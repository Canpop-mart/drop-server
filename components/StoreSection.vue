<template>
  <section v-if="!hidden" class="w-full">
    <div class="flex items-center justify-between px-1 mb-4">
      <div class="flex items-center gap-x-3">
        <component
          :is="icon"
          v-if="icon"
          class="size-5 text-blue-400"
        />
        <h2 class="text-xl font-bold font-display text-zinc-100">
          {{ title }}
        </h2>
      </div>
      <NuxtLink
        v-if="viewAllHref"
        :href="viewAllHref"
        class="text-sm text-blue-400 hover:text-blue-300 transition-colors flex items-center gap-x-1"
      >
        {{ $t("store.sections.viewAll") }}
        <ChevronRightIcon class="size-4" />
      </NuxtLink>
    </div>
    <p v-if="subtitle" class="text-sm text-zinc-500 px-1 -mt-2 mb-4">
      {{ subtitle }}
    </p>
    <div v-if="loading" class="flex gap-x-4 overflow-hidden">
      <div
        v-for="i in skeletonCount"
        :key="i"
        class="w-[192px] shrink-0 aspect-[3/4] rounded-lg bg-zinc-800/50 animate-pulse"
      />
    </div>
    <div v-else-if="items.length === 0" class="py-6 text-center">
      <p class="text-zinc-600 text-sm">{{ emptyText ?? $t("store.sections.empty") }}</p>
    </div>
    <GameCarousel v-else :items="items" />
  </section>
</template>

<script setup lang="ts">
import { ChevronRightIcon } from "@heroicons/vue/24/outline";
import type { GameModel } from "~/prisma/client/models";
import type { SerializeObject } from "nitropack";
import type { Component } from "vue";

withDefaults(
  defineProps<{
    title: string;
    subtitle?: string;
    icon?: Component;
    viewAllHref?: string;
    items: Array<SerializeObject<GameModel>>;
    loading?: boolean;
    hidden?: boolean;
    emptyText?: string;
    skeletonCount?: number;
  }>(),
  {
    subtitle: undefined,
    icon: undefined,
    viewAllHref: undefined,
    skeletonCount: 6,
  },
);
</script>
