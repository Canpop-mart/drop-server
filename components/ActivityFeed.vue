<template>
  <div class="space-y-3">
    <div
      v-for="item in items"
      :key="combineKey(item)"
      class="flex items-start gap-3 p-3 rounded-lg bg-zinc-800/30 hover:bg-zinc-800/50 transition-colors"
    >
      <img
        v-if="item.user?.profilePictureObjectId"
        :src="useObject(item.user.profilePictureObjectId)"
        class="size-10 rounded-full shrink-0"
      />
      <div class="flex-1 min-w-0">
        <p class="text-sm text-zinc-100">
          <NuxtLink
            :to="`/user/${item.user?.id}`"
            class="font-medium hover:underline"
            >{{ item.user?.displayName || item.user?.username }}</NuxtLink
          >
          <span class="text-zinc-400 ml-1">
            <template v-if="item.type === 'session'"
              >{{ $t("community.activity.played") }}
              {{ item.game?.mName }}</template
            >
            <template v-else-if="item.type === 'achievement'"
              >{{ $t("community.activity.unlocked") }}
              <span class="text-blue-400">{{
                item.data?.achievement?.title
              }}</span>
              {{ $t("community.activity.in") }} {{ item.game?.mName }}</template
            >
          </span>
        </p>
        <p class="text-xs text-zinc-500 mt-1">
          {{ formatTime(item.timestamp) }}
        </p>
      </div>
      <img
        v-if="item.type === 'achievement' && item.data?.achievement?.iconUrl"
        :src="item.data.achievement.iconUrl"
        class="size-8 rounded shrink-0"
      />
      <img
        v-else-if="item.game?.mIconObjectId"
        :src="useObject(item.game.mIconObjectId)"
        class="size-8 rounded shrink-0"
      />
    </div>
    <div v-if="items.length === 0" class="text-center py-8 text-zinc-500">
      {{ $t("community.activity.empty") }}
    </div>
  </div>
</template>
<script setup lang="ts">
import { useObject } from "~/composables/objects";

interface ActivityItem {
  type: string;
  timestamp: Date | string;
  user?: {
    id?: string;
    username?: string;
    displayName?: string;
    profilePictureObjectId?: string;
  };
  game?: { mName?: string; mIconObjectId?: string };
  data?: { achievement?: { title?: string; iconUrl?: string } };
}

defineProps<{ items: ActivityItem[] }>();
const combineKey = (item: ActivityItem) =>
  `${item.type}-${item.timestamp}-${item.user?.id}`;
const formatTime = (d: Date | string) => {
  const date = new Date(d);
  const now = new Date();
  const diff = (now.getTime() - date.getTime()) / 1000;
  if (diff < 60) return "Just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return date.toLocaleDateString();
};
</script>
