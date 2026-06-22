<template>
  <div v-if="collection" class="max-w-3xl space-y-8">
    <NuxtLink
      to="/admin/collections"
      class="inline-flex items-center gap-x-2 text-sm text-zinc-400 hover:text-zinc-100"
    >
      <ArrowLeftIcon class="size-4" /> Back to collections
    </NuxtLink>

    <!-- Cover -->
    <div>
      <p
        class="mb-2 text-xs font-medium uppercase tracking-wider text-zinc-500"
      >
        Cover
      </p>
      <div
        class="relative aspect-video max-w-md overflow-hidden rounded-xl bg-zinc-800"
      >
        <img
          v-if="collection.coverObjectId"
          :src="useObject(collection.coverObjectId)"
          class="size-full object-cover"
        />
        <div
          v-else
          class="flex size-full items-center justify-center text-sm text-zinc-600"
        >
          No cover set
        </div>
      </div>
      <label
        class="mt-2 inline-flex cursor-pointer items-center gap-x-2 rounded-md bg-zinc-800/50 px-3 py-1.5 text-sm font-medium text-zinc-200 hover:bg-zinc-800"
        :class="{ 'pointer-events-none opacity-50': coverUploading }"
      >
        <PhotoIcon class="size-4" />
        {{ coverUploading ? "Uploading..." : "Change cover" }}
        <input
          type="file"
          accept="image/*"
          class="hidden"
          @change="onCoverSelect"
        />
      </label>
    </div>

    <!-- Name + description -->
    <div class="space-y-4">
      <div>
        <label
          class="mb-1 block text-xs font-medium uppercase tracking-wider text-zinc-500"
          >Name</label
        >
        <input
          v-model="name"
          type="text"
          maxlength="120"
          class="w-full rounded-md border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/30"
        />
      </div>
      <div>
        <label
          class="mb-1 block text-xs font-medium uppercase tracking-wider text-zinc-500"
          >Description</label
        >
        <textarea
          v-model="description"
          rows="3"
          maxlength="500"
          class="w-full resize-none rounded-md border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/30"
        />
      </div>
      <button
        :disabled="!metaDirty || savingMeta"
        class="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-50"
        @click="saveMeta"
      >
        {{ savingMeta ? "Saving..." : "Save details" }}
      </button>
    </div>

    <!-- Visibility + featured -->
    <div class="space-y-2">
      <div class="flex flex-wrap gap-3">
        <button
          class="rounded-md px-3 py-2 text-sm font-medium ring-1"
          :class="
            collection.isPublic
              ? 'bg-green-600/15 text-green-400 ring-green-600/30'
              : 'bg-zinc-800 text-zinc-400 ring-zinc-700'
          "
          @click="togglePublic"
        >
          {{ collection.isPublic ? "Public" : "Private" }}
        </button>
        <button
          class="rounded-md px-3 py-2 text-sm font-medium ring-1"
          :class="
            collection.featured
              ? 'bg-blue-600/15 text-blue-400 ring-blue-600/30'
              : 'bg-zinc-800 text-zinc-400 ring-zinc-700'
          "
          @click="toggleFeatured"
        >
          {{ collection.featured ? "Featured on store" : "Not featured" }}
        </button>
      </div>
      <p class="text-xs text-zinc-500">
        Featuring forces the collection public and shows it on the store-home
        Collections shelf.
      </p>
    </div>

    <!-- Games -->
    <div>
      <div class="mb-2 flex items-center justify-between">
        <h2 class="text-sm font-medium text-zinc-300">
          Games ({{ games.length }})
        </h2>
        <button
          class="rounded-md bg-zinc-800/50 px-3 py-1.5 text-sm font-medium text-zinc-200 hover:bg-zinc-800"
          @click="pickerOpen = true"
        >
          Add games
        </button>
      </div>
      <ul class="divide-y divide-zinc-800 rounded-lg ring-1 ring-zinc-800">
        <li
          v-for="(g, i) in games"
          :key="g.id"
          class="flex items-center gap-3 px-3 py-2"
        >
          <img
            v-if="g.mCoverObjectId"
            :src="useObject(g.mCoverObjectId)"
            class="h-10 w-8 shrink-0 rounded object-cover"
          />
          <span class="flex-1 truncate text-sm text-zinc-200">{{
            g.mName
          }}</span>
          <button
            :disabled="i === 0"
            class="px-1 text-zinc-500 hover:text-zinc-200 disabled:opacity-30"
            @click="move(i, -1)"
          >
            ↑
          </button>
          <button
            :disabled="i === games.length - 1"
            class="px-1 text-zinc-500 hover:text-zinc-200 disabled:opacity-30"
            @click="move(i, 1)"
          >
            ↓
          </button>
          <button
            class="text-xs text-red-400 hover:text-red-300"
            @click="removeGame(g.id)"
          >
            Remove
          </button>
        </li>
        <li v-if="games.length === 0" class="px-3 py-4 text-sm text-zinc-500">
          No games yet. Add some.
        </li>
      </ul>
    </div>

    <!-- Delete -->
    <div class="border-t border-zinc-800 pt-4">
      <button
        class="text-sm text-red-400 hover:text-red-300"
        @click="deleteCollection"
      >
        Delete collection
      </button>
    </div>

    <ModalAddCollectionGames
      v-model="pickerOpen"
      :existing-ids="games.map((g) => g.id)"
      @add="addGames"
    />
  </div>
</template>

<script setup lang="ts">
import { ArrowLeftIcon } from "@heroicons/vue/20/solid";
import { PhotoIcon } from "@heroicons/vue/24/solid";

definePageMeta({ layout: "admin" });

interface CollectionGame {
  id: string;
  mName: string;
  mCoverObjectId: string | null;
}
interface CollectionEntry {
  gameId: string;
  sortIndex: number;
  game: CollectionGame;
}
interface AdminCollection {
  id: string;
  name: string;
  description: string | null;
  coverObjectId: string | null;
  featured: boolean;
  isPublic: boolean;
  entries: CollectionEntry[];
}

const route = useRoute();
const router = useRouter();
const id = route.params.id as string;

const collection = ref<AdminCollection | null>(null);
const name = ref("");
const description = ref("");
const games = ref<CollectionGame[]>([]);

async function load() {
  const c = await $dropFetch<AdminCollection>(`/api/v1/collection/${id}`);
  collection.value = c;
  name.value = c.name;
  description.value = c.description ?? "";
  games.value = [...c.entries]
    .sort((a, b) => a.sortIndex - b.sortIndex)
    .map((e) => e.game);
}
await load();

useHead({ title: () => collection.value?.name ?? "Collection" });

const metaDirty = computed(
  () =>
    !!collection.value &&
    (name.value !== collection.value.name ||
      description.value !== (collection.value.description ?? "")),
);
const savingMeta = ref(false);
async function saveMeta() {
  if (!metaDirty.value || savingMeta.value) return;
  savingMeta.value = true;
  try {
    await $dropFetch(`/api/v1/collection/${id}`, {
      method: "PATCH",
      body: { name: name.value, description: description.value || null },
      failTitle: "Failed to save details",
    });
    if (collection.value) {
      collection.value.name = name.value;
      collection.value.description = description.value || null;
    }
  } finally {
    savingMeta.value = false;
  }
}

const coverUploading = ref(false);
async function onCoverSelect(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  coverUploading.value = true;
  try {
    const form = new FormData();
    form.append("file", file);
    const res = await $dropFetch<{ coverObjectId: string }>(
      `/api/v1/collection/${id}/cover`,
      { method: "POST", body: form, failTitle: "Failed to upload cover" },
    );
    if (collection.value) collection.value.coverObjectId = res.coverObjectId;
  } finally {
    coverUploading.value = false;
  }
}

async function togglePublic() {
  if (!collection.value) return;
  const next = !collection.value.isPublic;
  await $dropFetch(`/api/v1/collection/${id}/visibility`, {
    method: "PUT",
    body: { isPublic: next },
    failTitle: "Failed to update visibility",
  });
  collection.value.isPublic = next;
  if (!next) collection.value.featured = false;
}

async function toggleFeatured() {
  if (!collection.value) return;
  const next = !collection.value.featured;
  await $dropFetch(`/api/v1/collection/${id}/featured`, {
    method: "PUT",
    body: { featured: next },
    failTitle: "Failed to update featured",
  });
  collection.value.featured = next;
  if (next) collection.value.isPublic = true;
}

async function persistOrder() {
  await $dropFetch(`/api/v1/collection/${id}/order`, {
    method: "PUT",
    body: { gameIds: games.value.map((g) => g.id) },
    failTitle: "Failed to reorder",
  });
}
function move(i: number, dir: number) {
  const j = i + dir;
  if (j < 0 || j >= games.value.length) return;
  const arr = [...games.value];
  [arr[i], arr[j]] = [arr[j], arr[i]];
  games.value = arr;
  persistOrder();
}

async function removeGame(gameId: string) {
  await $dropFetch(`/api/v1/collection/${id}/entry`, {
    method: "DELETE",
    body: { id: gameId },
    failTitle: "Failed to remove game",
  });
  games.value = games.value.filter((g) => g.id !== gameId);
}

const pickerOpen = ref(false);
async function addGames(gameIds: string[]) {
  for (const gameId of gameIds) {
    await $dropFetch(`/api/v1/collection/${id}/entry`, {
      method: "POST",
      body: { id: gameId },
      failTitle: "Failed to add game",
    });
  }
  await load();
}

async function deleteCollection() {
  if (!window.confirm("Delete this collection? This cannot be undone.")) return;
  await $dropFetch(`/api/v1/collection/${id}`, { method: "DELETE" });
  await router.push("/admin/collections");
}
</script>
