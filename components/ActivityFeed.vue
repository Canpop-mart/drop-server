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
      <div v-else class="size-10 rounded-full bg-zinc-700 shrink-0" />
      <div class="flex-1 min-w-0">
        <p class="text-sm text-zinc-100">
          <NuxtLink
            :to="`/user/${item.user?.id}`"
            class="font-medium hover:underline"
            >{{ item.user?.displayName || item.user?.username }}</NuxtLink
          >
          <span class="text-zinc-400 ml-1">
            <template v-if="item.type === 'session'">
              {{ $t("community.activity.played") }}
              <NuxtLink
                v-if="item.game?.id"
                :to="`/store/${item.game.id}`"
                class="text-zinc-200 hover:text-blue-400 transition-colors"
                >{{ item.game?.mName }}</NuxtLink
              >
              <template v-else>{{ item.game?.mName }}</template>
            </template>
            <template v-else-if="item.type === 'achievement'">
              {{ $t("community.activity.unlocked") }}
              <span class="text-blue-400">{{
                item.data?.achievement?.title
              }}</span>
              {{ $t("community.activity.in") }}
              <NuxtLink
                v-if="item.game?.id"
                :to="`/store/${item.game.id}`"
                class="text-zinc-200 hover:text-blue-400 transition-colors"
                >{{ item.game?.mName }}</NuxtLink
              >
              <template v-else>{{ item.game?.mName }}</template>
            </template>
            <template v-else-if="item.type === 'request'">
              {{ $t("community.activity.requestApproved") }}
              <span class="text-green-400">{{
                item.data?.request?.title
              }}</span>
            </template>
          </span>
        </p>
        <p class="text-xs text-zinc-500 mt-1">
          {{ formatTime(item.timestamp) }}
        </p>
      </div>
      <!-- Icon on right -->
      <template v-if="item.type === 'achievement'">
        <img
          v-if="
            item.data?.achievement?.iconUrl &&
            item.data.achievement.iconUrl.trim() !== '' &&
            !achIconErrors[combineKey(item)]
          "
          :src="item.data.achievement.iconUrl"
          class="size-8 rounded shrink-0"
          @error="achIconErrors[combineKey(item)] = true"
        />
        <div
          v-else
          class="size-8 rounded shrink-0 bg-zinc-700/50 flex items-center justify-center"
        >
          <TrophyIcon class="size-4 text-zinc-500" />
        </div>
      </template>
      <img
        v-else-if="item.game?.mIconObjectId"
        :src="useObject(item.game.mIconObjectId)"
        class="size-8 rounded shrink-0"
      />
      <div
        v-else-if="item.type === 'request'"
        class="size-8 rounded shrink-0 bg-green-500/10 flex items-center justify-center"
      >
        <CheckIcon class="size-4 text-green-400" />
      </div>
    </div>
    <div v-if="items.length === 0" class="text-center py-8 text-zinc-500">
      {{ $t("community.activity.empty") }}
    </div>
    <div v-if="hasMore" class="pt-2 text-center">
      <button
        class="text-sm text-zinc-400 hover:text-zinc-100 transition-colors"
        :disabled="loadingMore"
        @click="$emit('loadMore')"
      >
        {{ loadingMore ? $t("common.srLoading") : $t("community.loadMore") }}
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { CheckIcon } from "@heroicons/vue/24/outline";
import { TrophyIcon } from "@heroicons/vue/24/solid";
import { useObject } from "~/composables/objects";

// Achievement icon error tracking
const achIconErrors = reactive<Record<string, boolean>>({});

interface ActivityItem {
  type: string;
  timestamp: Date | string;
  user?: {
    id?: string;
    username?: string;
    displayName?: string;
    profilePictureObjectId?: string;
  };
  game?: { id?: string; mName?: string; mIconObjectId?: string };
  data?: {
    achievement?: { title?: string; iconUrl?: string };
    request?: { id?: string; title?: string };
  };
}

defineProps<{
  items: ActivityItem[];
  hasMore?: boolean;
  loadingMore?: boolean;
}>();
defineEmits<{ loadMore: [] }>();

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
