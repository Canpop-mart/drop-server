<template>
  <div class="p-4 rounded-lg bg-zinc-800/50 border border-zinc-700/50">
    <div class="flex items-center gap-3 mb-3">
      <img
        v-if="review.user?.profilePictureObjectId"
        :src="useObject(review.user.profilePictureObjectId)"
        class="size-8 rounded-full"
      />
      <div class="flex-1">
        <p class="text-sm font-medium text-zinc-100">
          {{ review.user?.displayName || review.user?.username || "Anonymous" }}
        </p>
        <RelativeTime :date="review.createdAt" class="text-xs text-zinc-500" />
      </div>
      <StarRating :model-value="review.rating" />
    </div>
    <p v-if="review.body" class="text-sm text-zinc-300">{{ review.body }}</p>
  </div>
</template>
<script setup lang="ts">
import { useObject } from "~/composables/objects";
defineProps<{
  review: {
    user?: {
      profilePictureObjectId?: string;
      displayName?: string;
      username?: string;
    };
    rating: number;
    body?: string;
    createdAt: Date;
  };
}>();
</script>
