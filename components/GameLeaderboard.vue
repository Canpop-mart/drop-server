<template>
  <div>
    <div v-if="loading" class="text-zinc-500 text-center py-8">
      {{ $t("common.srLoading") }}
    </div>
    <div v-else-if="!board" class="text-zinc-500 text-center py-8">
      {{ $t("store.leaderboard.error") }}
    </div>
    <template v-else>
      <!-- User's own entry callout -->
      <div
        v-if="board.userEntry"
        class="mb-4 flex items-center gap-3 p-3 rounded-lg bg-blue-500/10 ring-1 ring-blue-500/20 text-sm"
      >
        <TrophyIcon class="size-4 text-blue-400 shrink-0" />
        <span class="text-zinc-300"
          >{{ $t("store.leaderboard.yourRank") }}
          <span class="font-bold text-blue-400"
            >#{{ board.userEntry.rank }}</span
          >
          {{ $t("store.leaderboard.withScore") }}
          <span class="font-bold text-zinc-100">{{
            formatScore(board.userEntry.score, board.type)
          }}</span></span
        >
      </div>

      <!-- Empty state -->
      <div
        v-if="board.entries.length === 0"
        class="text-zinc-500 text-center py-8"
      >
        {{ $t("store.leaderboard.empty") }}
      </div>

      <!-- Entries table -->
      <div v-else class="space-y-1">
        <div
          v-for="entry in board.entries"
          :key="entry.id"
          :class="[
            'flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors',
            entry.user?.id === currentUser?.id
              ? 'bg-blue-500/10 ring-1 ring-blue-500/20'
              : 'bg-zinc-800/40 hover:bg-zinc-800/70',
          ]"
        >
          <!-- Rank -->
          <span
            :class="[
              'w-8 text-center text-sm font-bold shrink-0',
              entry.rank === 1
                ? 'text-yellow-400'
                : entry.rank === 2
                  ? 'text-zinc-300'
                  : entry.rank === 3
                    ? 'text-orange-400'
                    : 'text-zinc-500',
            ]"
            >#{{ entry.rank }}</span
          >
          <!-- Avatar -->
          <img
            v-if="entry.user?.profilePictureObjectId"
            :src="useObject(entry.user.profilePictureObjectId)"
            class="size-7 rounded-full shrink-0"
          />
          <div v-else class="size-7 rounded-full bg-zinc-700 shrink-0" />
          <!-- Name -->
          <NuxtLink
            :to="`/user/${entry.user?.id}`"
            class="flex-1 text-sm text-zinc-200 hover:text-blue-400 transition-colors truncate"
            >{{ entry.user?.displayName || entry.user?.username }}</NuxtLink
          >
          <!-- Score -->
          <span class="text-sm font-semibold text-zinc-100 shrink-0">{{
            formatScore(entry.score, board.type)
          }}</span>
          <!-- Date -->
          <RelativeTime
            :date="entry.submittedAt"
            class="text-xs text-zinc-600 shrink-0 hidden sm:block"
          />
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { TrophyIcon } from "@heroicons/vue/24/outline";
import { useObject } from "~/composables/objects";
import { useUser } from "~/composables/user";

const props = defineProps<{
  gameId: string;
  boardId: string;
  boardType: string;
}>();

const currentUser = useUser();

type BoardEntry = {
  id: string;
  score: number;
  rank: number;
  submittedAt: string;
  user: {
    id: string;
    username: string;
    displayName: string;
    profilePictureObjectId: string;
  } | null;
};

type Board = {
  id: string;
  name: string;
  type: string;
  sortOrder: string;
  entries: BoardEntry[];
  userEntry: { score: number; rank: number; submittedAt: string } | null;
};

const loading = ref(true);
const board = ref<Board | null>(null);

onMounted(async () => {
  board.value = (await $dropFetch(
    `/api/v1/games/${props.gameId}/leaderboards/${props.boardId}`,
  ).catch(() => null)) as Board | null;
  loading.value = false;
});

function formatScore(score: number, type: string): string {
  switch (type) {
    case "Playtime":
      return `${Math.round(score)}h`;
    case "AchievementCount":
      return score.toFixed(0);
    case "Speedrun": {
      const ms = Math.round(score);
      const h = Math.floor(ms / 3600000);
      const m = Math.floor((ms % 3600000) / 60000);
      const s = Math.floor((ms % 60000) / 1000);
      const cs = Math.floor((ms % 1000) / 10);
      if (h > 0)
        return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
      return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
    }
    default:
      return score.toLocaleString();
  }
}
</script>
