<template>
  <div ref="searchContainer" class="relative w-full max-w-2xl">
    <div
      :class="[
        'flex items-center gap-x-2 rounded-lg border px-3 py-2 transition-colors duration-200',
        focused
          ? 'border-blue-500 bg-zinc-900 ring-1 ring-blue-500/50'
          : 'border-zinc-700 bg-zinc-900/60 hover:border-zinc-600',
      ]"
    >
      <MagnifyingGlassIcon class="size-5 text-zinc-400 shrink-0" />
      <input
        ref="searchInput"
        v-model="searchQuery"
        type="text"
        :placeholder="$t('store.search.placeholder')"
        class="flex-1 bg-transparent text-zinc-100 placeholder-zinc-500 outline-none text-sm"
        @focus="focused = true"
        @keydown.escape="closeDropdown"
        @keydown.enter="navigateToFirst"
        @keydown.down.prevent="highlightNext"
        @keydown.up.prevent="highlightPrev"
      />
      <button
        v-if="searchQuery.length > 0"
        class="text-zinc-500 hover:text-zinc-300 transition-colors"
        @click="clearSearch"
      >
        <XMarkIcon class="size-4" />
      </button>
    </div>

    <!-- Autocomplete dropdown -->
    <Transition
      enter-active-class="transition ease-out duration-150"
      enter-from-class="opacity-0 translate-y-1"
      enter-to-class="opacity-100 translate-y-0"
      leave-active-class="transition ease-in duration-100"
      leave-from-class="opacity-100 translate-y-0"
      leave-to-class="opacity-0 translate-y-1"
    >
      <div
        v-if="showDropdown"
        class="absolute z-50 mt-2 w-full rounded-lg border border-zinc-700 bg-zinc-900 shadow-xl overflow-hidden"
      >
        <div v-if="loading" class="px-4 py-6 text-center text-zinc-500 text-sm">
          {{ $t("store.search.searching") }}
        </div>
        <div
          v-else-if="results.length === 0 && searchQuery.length >= 2"
          class="px-4 py-6 text-center text-zinc-500 text-sm"
        >
          {{ $t("store.search.noResults") }}
        </div>
        <div v-else>
          <NuxtLink
            v-for="(result, index) in results"
            :key="result.id"
            :href="`/store/${result.id}`"
            :class="[
              'flex items-center gap-x-3 px-4 py-3 transition-colors duration-100 cursor-pointer',
              highlightedIndex === index
                ? 'bg-zinc-800'
                : 'hover:bg-zinc-800/60',
            ]"
            @mouseenter="highlightedIndex = index"
            @click="closeDropdown"
          >
            <img
              :src="useObject(result.icon)"
              :alt="result.name"
              class="w-10 h-10 rounded object-cover shrink-0"
            />
            <div class="flex-1 min-w-0">
              <div class="text-sm font-medium text-zinc-100 truncate">
                {{ result.name }}
              </div>
              <div class="text-xs text-zinc-500 truncate">
                {{ result.description }}
              </div>
            </div>
            <div class="text-xs text-zinc-600 shrink-0">
              {{ new Date(result.released).getFullYear() }}
            </div>
          </NuxtLink>
        </div>
      </div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { MagnifyingGlassIcon, XMarkIcon } from "@heroicons/vue/24/outline";
import { useObject } from "~/composables/objects";

interface SearchResult {
  id: string;
  name: string;
  icon: string;
  cover: string;
  description: string;
  released: string;
  similarity: number;
}

const searchQuery = ref("");
const focused = ref(false);
const loading = ref(false);
const results = ref<SearchResult[]>([]);
const highlightedIndex = ref(-1);
const searchContainer = ref<HTMLElement | null>(null);
const searchInput = ref<HTMLInputElement | null>(null);

let debounceTimer: ReturnType<typeof setTimeout> | null = null;

const showDropdown = computed(
  () => focused.value && searchQuery.value.length >= 2,
);

watch(searchQuery, (q) => {
  if (debounceTimer) clearTimeout(debounceTimer);
  highlightedIndex.value = -1;

  if (q.trim().length < 2) {
    results.value = [];
    loading.value = false;
    return;
  }

  loading.value = true;
  debounceTimer = setTimeout(async () => {
    try {
      const data = await $fetch("/api/v1/store/search", {
        query: { q: q.trim(), take: 8 },
      });
      results.value = data.results;
    } catch {
      results.value = [];
    } finally {
      loading.value = false;
    }
  }, 250);
});

function closeDropdown() {
  focused.value = false;
  searchInput.value?.blur();
}

function clearSearch() {
  searchQuery.value = "";
  results.value = [];
  searchInput.value?.focus();
}

function navigateToFirst() {
  const idx = highlightedIndex.value >= 0 ? highlightedIndex.value : 0;
  if (results.value[idx]) {
    navigateTo(`/store/${results.value[idx].id}`);
    closeDropdown();
  }
}

function highlightNext() {
  if (results.value.length === 0) return;
  highlightedIndex.value =
    (highlightedIndex.value + 1) % results.value.length;
}

function highlightPrev() {
  if (results.value.length === 0) return;
  highlightedIndex.value =
    highlightedIndex.value <= 0
      ? results.value.length - 1
      : highlightedIndex.value - 1;
}

// Close dropdown on outside click
onMounted(() => {
  document.addEventListener("click", handleOutsideClick);
});

onUnmounted(() => {
  document.removeEventListener("click", handleOutsideClick);
  if (debounceTimer) clearTimeout(debounceTimer);
});

function handleOutsideClick(e: MouseEvent) {
  if (
    searchContainer.value &&
    !searchContainer.value.contains(e.target as Node)
  ) {
    focused.value = false;
  }
}
</script>
