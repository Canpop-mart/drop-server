<template>
  <Teleport to="body">
    <TransitionGroup
      tag="div"
      class="fixed bottom-6 right-6 z-[9999] flex flex-col gap-3 pointer-events-none"
      enter-active-class="transition-all duration-500 ease-out"
      enter-from-class="translate-x-full opacity-0"
      enter-to-class="translate-x-0 opacity-100"
      leave-active-class="transition-all duration-300 ease-in"
      leave-from-class="translate-x-0 opacity-100"
      leave-to-class="translate-x-full opacity-0"
    >
      <div
        v-for="toast in toasts"
        :key="toast.id"
        class="pointer-events-auto flex items-center gap-3 px-4 py-3 bg-zinc-900 ring-1 ring-yellow-500/30 rounded-xl shadow-2xl shadow-yellow-500/10 max-w-sm"
      >
        <img
          v-if="toast.iconUrl"
          :src="toast.iconUrl"
          class="size-12 rounded-lg shrink-0"
        />
        <div
          v-else
          class="size-12 rounded-lg shrink-0 bg-yellow-500/10 flex items-center justify-center"
        >
          <TrophyIcon class="size-6 text-yellow-400" />
        </div>
        <div class="flex-1 min-w-0">
          <p
            class="text-xs font-medium text-yellow-400 uppercase tracking-wide"
          >
            {{ $t("achievements.unlocked") }}
          </p>
          <p class="text-sm font-semibold text-zinc-100 truncate">
            {{ toast.title }}
          </p>
          <p v-if="toast.gameName" class="text-xs text-zinc-400 truncate">
            {{ toast.gameName }}
          </p>
        </div>
      </div>
    </TransitionGroup>
  </Teleport>
</template>

<script setup lang="ts">
import { TrophyIcon } from "@heroicons/vue/24/solid";

interface AchievementToastItem {
  id: string;
  title: string;
  iconUrl?: string;
  gameName?: string;
}

const toasts = ref<AchievementToastItem[]>([]);
const notifications = useNotifications();

watch(
  () => notifications.value.length,
  () => {
    // Check latest notifications for achievement unlocks
    for (const notif of notifications.value) {
      if (
        notif.nonce?.startsWith("achievement-unlock:") &&
        !toasts.value.find((t) => t.id === notif.nonce)
      ) {
        const toast: AchievementToastItem = {
          id: notif.nonce,
          title: notif.title,
          iconUrl: notif.actions?.[0] ?? undefined,
          gameName: notif.description ?? undefined,
        };
        toasts.value.push(toast);
        // Auto-dismiss after 6 seconds
        setTimeout(() => {
          toasts.value = toasts.value.filter((t) => t.id !== toast.id);
        }, 6000);
      }
    }
  },
);
</script>
