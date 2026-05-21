<template>
  <div class="bg-zinc-800/50 rounded-xl p-6 ring-1 ring-white/5 space-y-4">
    <div class="flex items-center justify-between">
      <h2 class="text-lg font-semibold text-zinc-100">
        {{ providerLabel }} achievements ({{ achievements.length }})
      </h2>
      <button
        v-if="achievements.length > 0"
        class="px-3 py-1.5 bg-red-600/80 hover:bg-red-500 text-white text-xs font-medium rounded-md transition-colors"
        @click="emit('reset')"
      >
        {{ $t("admin.achievements.resetAll") }}
      </button>
    </div>

    <div
      v-if="achievements.length > 0"
      class="space-y-1 max-h-96 overflow-y-auto"
    >
      <div
        v-for="ach in achievements"
        :key="ach.id"
        class="flex items-center gap-3 p-2 rounded-lg hover:bg-zinc-900/50 transition-colors"
      >
        <img
          v-if="ach.iconUrl && ach.iconUrl.trim() !== '' && !iconErrors[ach.id]"
          :src="ach.iconUrl"
          class="size-8 rounded"
          @error="iconErrors[ach.id] = true"
        />
        <div
          v-else
          class="size-8 rounded bg-zinc-700/50 flex items-center justify-center"
        >
          <TrophyIcon class="size-4 text-zinc-500" />
        </div>
        <div class="flex-1 min-w-0">
          <p class="text-sm text-zinc-100 truncate">{{ ach.title }}</p>
          <p class="text-xs text-zinc-500 truncate">{{ ach.description }}</p>
        </div>
        <span class="text-xs text-zinc-600">{{ ach.externalId }}</span>
      </div>
    </div>
    <p v-else class="text-sm text-zinc-500">
      {{ $t("admin.achievements.noAchievements") }}
    </p>
  </div>
</template>

<script setup lang="ts">
import { TrophyIcon } from "@heroicons/vue/24/solid";

/**
 * Read-only achievement list for one provider, used by the per-provider
 * tabs on the admin achievements page. Icon URLs are raw CDN URLs
 * (Steam / RetroAchievements) — never proxied through the object store.
 */
interface AchievementRow {
  id: string;
  title: string;
  description: string;
  iconUrl: string;
  externalId: string;
  provider: string;
}

defineProps<{
  achievements: AchievementRow[];
  providerLabel: string;
}>();

const emit = defineEmits<{ reset: [] }>();

const iconErrors = reactive<Record<string, boolean>>({});
</script>
