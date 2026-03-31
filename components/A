<template>
  <div class="flex flex-col gap-2">
    <div v-if="achievement" class="flex items-center gap-3 p-3 rounded-lg bg-zinc-800/50 hover:bg-zinc-700/50 transition-colors">
      <img :src="achievement.iconLockedUrl || achievement.iconUrl" class="size-10 rounded" />
      <div class="flex-1 min-w-0">
        <p class="text-sm font-medium text-zinc-100 truncate">{{ achievement.title }}</p>
        <p class="text-xs text-zinc-400 line-clamp-1">{{ achievement.description }}</p>
      </div>
      <div v-if="unlockedAt" class="text-xs text-zinc-500">{{ formatDate(unlockedAt) }}</div>
      <div v-else class="text-xs text-zinc-600">{{ $t('achievements.locked') }}</div>
    </div>
  </div>
</template>
<script setup lang="ts">
const props = defineProps<{
  achievement: { id: string; title: string; description: string; iconUrl: string; iconLockedUrl: string };
  unlockedAt?: Date | string | null;
}>();
const formatDate = (d: Date | string) => new Date(d).toLocaleDateString();
</script>