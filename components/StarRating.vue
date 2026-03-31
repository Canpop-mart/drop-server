<template>
  <div class="flex items-center gap-1">
    <button v-for="n in 5" :key="n" @click="interactive && emit('update:modelValue', n)" class="focus:outline-none">
      <StarIcon :class="[n <= modelValue ? 'text-yellow-400' : 'text-zinc-600', 'size-5 transition-colors', interactive ? 'hover:scale-110 hover:text-yellow-300' : '']" />
    </button>
    <slot />
  </div>
</template>
<script setup lang="ts">
import { StarIcon } from "@heroicons/vue/24/solid";
defineProps<{ modelValue: number; interactive?: boolean }>();
const emit = defineEmits<{ "update:modelValue": [value: number] }>();
</script>