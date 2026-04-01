<template>
  <div
    class="flex items-center gap-4 p-4 rounded-lg bg-zinc-800/50 hover:bg-zinc-800/70 transition-colors"
  >
    <span class="text-2xl font-bold text-zinc-500 w-12 text-center">{{
      rank
    }}</span>
    <img
      v-if="user?.profilePictureObjectId"
      :src="useObject(user.profilePictureObjectId)"
      class="size-12 rounded-full"
    />
    <div class="flex-1 min-w-0">
      <NuxtLink
        :to="`/user/${user?.id}`"
        class="font-medium text-zinc-100 hover:text-blue-400 truncate block"
        >{{ user?.displayName || user?.username || "Unknown" }}</NuxtLink
      >
      <div class="flex gap-4 text-xs text-zinc-500 mt-1">
        <span>{{
          $t("community.leaderboard.hoursPlayed", { hours: playtimeHours })
        }}</span>
        <span>{{
          $t("community.leaderboard.achievements", { count: achievements })
        }}</span>
        <span>{{
          $t("community.leaderboard.games", { count: gamesOwned })
        }}</span>
      </div>
    </div>
    <div class="text-right shrink-0">
      <span class="text-lg font-bold text-blue-400"
        >{{ playtimeHours }}{{ $t("community.stats.hoursSuffix") }}</span
      >
    </div>
  </div>
</template>
<script setup lang="ts">
import { useObject } from "~/composables/objects";
defineProps<{
  rank: number;
  user?: {
    id?: string;
    username?: string;
    displayName?: string;
    profilePictureObjectId?: string;
  };
  playtimeHours: number;
  achievements: number;
  gamesOwned: number;
}>();
</script>
