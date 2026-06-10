<template>
  <ModalTemplate v-model="open">
    <template #default>
      <div>
        <DialogTitle as="h3" class="text-lg font-medium leading-6 text-white">
          Add games
        </DialogTitle>
        <p class="mt-1 text-sm text-zinc-400">
          Search and select games to add to this collection.
        </p>
      </div>
      <div class="mt-3 space-y-2">
        <input
          v-model="search"
          type="text"
          placeholder="Search games..."
          class="block w-full rounded-md border-0 bg-zinc-800 px-2 py-1.5 text-white shadow-sm ring-1 ring-inset ring-zinc-700 placeholder:text-zinc-400 focus:ring-2 focus:ring-inset focus:ring-blue-600 sm:text-sm"
        />
        <div class="flex items-center justify-between text-xs text-zinc-400">
          <span>{{ selected.size }} selected</span>
          <button
            v-if="filtered.length > 0"
            type="button"
            class="hover:text-zinc-200"
            @click="() => selectAllFiltered()"
          >
            Select all {{ filtered.length }} shown
          </button>
        </div>
        <div
          class="max-h-72 divide-y divide-zinc-800 overflow-y-auto rounded-md ring-1 ring-zinc-800"
        >
          <label
            v-for="game in filtered"
            :key="game.id"
            class="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm text-zinc-200 hover:bg-zinc-800/50"
          >
            <input
              type="checkbox"
              :checked="selected.has(game.id)"
              class="rounded border-zinc-600 bg-zinc-800 text-blue-600 focus:ring-blue-500"
              @change="() => toggle(game.id)"
            />
            <span class="truncate">{{ game.mName }}</span>
          </label>
          <div v-if="!gamesLoaded" class="px-3 py-4 text-sm text-zinc-500">
            Loading games...
          </div>
          <div
            v-else-if="filtered.length === 0"
            class="px-3 py-4 text-sm text-zinc-500"
          >
            No games match.
          </div>
        </div>
      </div>
    </template>

    <template #buttons="{ close }">
      <LoadingButton
        :loading="false"
        :disabled="selected.size === 0"
        class="w-full sm:w-fit"
        @click="() => apply()"
      >
        Add {{ selected.size }} game{{ selected.size === 1 ? "" : "s" }}
      </LoadingButton>
      <button
        type="button"
        class="mt-3 inline-flex w-full justify-center rounded-md bg-zinc-800 px-3 py-2 text-sm font-semibold text-zinc-100 shadow-sm ring-1 ring-inset ring-zinc-800 hover:bg-zinc-900 sm:mt-0 sm:w-auto"
        @click="() => close()"
      >
        {{ $t("cancel") }}
      </button>
    </template>
  </ModalTemplate>
</template>

<script setup lang="ts">
import { ref, computed, watch } from "vue";
import { DialogTitle } from "@headlessui/vue";
import type { SerializeObject } from "nitropack";

const props = defineProps<{ existingIds: string[] }>();
const open = defineModel<boolean>({ required: true });
const emit = defineEmits<{ (e: "add", gameIds: string[]): void }>();

type AdminGame = { id: string; mName: string };

const games = ref<Array<SerializeObject<AdminGame>>>([]);
const gamesLoaded = ref(false);
const search = ref("");
const selected = ref<Set<string>>(new Set());

const existing = computed(() => new Set(props.existingIds));
const filtered = computed(() => {
  const q = search.value.trim().toLowerCase();
  return games.value
    .filter((g) => !existing.value.has(g.id))
    .filter((g) => !q || g.mName.toLowerCase().includes(q));
});

// Lazy-load the lightweight game list on first open; reset on every open.
watch(open, async (isOpen) => {
  if (!isOpen) return;
  selected.value = new Set();
  search.value = "";
  if (!gamesLoaded.value) {
    games.value =
      await $dropFetch<Array<SerializeObject<AdminGame>>>("/api/v1/admin/game");
    gamesLoaded.value = true;
  }
});

function toggle(id: string) {
  const next = new Set(selected.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  selected.value = next;
}

function selectAllFiltered() {
  const next = new Set(selected.value);
  for (const g of filtered.value) next.add(g.id);
  selected.value = next;
}

function apply() {
  if (selected.value.size === 0) return;
  emit("add", Array.from(selected.value));
  open.value = false;
}
</script>
