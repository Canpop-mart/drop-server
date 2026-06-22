<template>
  <div class="space-y-6">
    <div class="sm:flex sm:items-center">
      <div class="sm:flex-auto">
        <h1 class="text-base font-semibold text-zinc-100">Store Collections</h1>
        <p class="mt-2 text-sm text-zinc-400">
          Curate game groups for the store. Add games, set a cover and a blurb,
          then make a collection public and feature it to surface it on the
          store home.
        </p>
      </div>
      <div class="mt-4 sm:mt-0 sm:flex-none">
        <button
          :disabled="creating"
          class="block rounded-md bg-blue-600 px-3 py-2 text-sm font-semibold text-white shadow-sm transition-all hover:bg-blue-500 disabled:opacity-50"
          @click="createCollection"
        >
          {{ creating ? "Creating..." : "New collection" }}
        </button>
      </div>
    </div>

    <div v-if="collections.length === 0" class="text-sm text-zinc-500">
      No collections yet. Create one to get started.
    </div>

    <ul
      v-else
      class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
    >
      <li
        v-for="c in collections"
        :key="c.id"
        class="overflow-hidden rounded-lg bg-zinc-900 ring-1 ring-zinc-800"
      >
        <NuxtLink :to="`/admin/collections/${c.id}`" class="block">
          <div class="aspect-video bg-zinc-800">
            <img
              v-if="c.coverObjectId"
              :src="useObject(c.coverObjectId)"
              class="size-full object-cover"
            />
          </div>
          <div class="p-3">
            <h3 class="truncate text-sm font-medium text-zinc-100">
              {{ c.name }}
            </h3>
            <p class="text-xs text-zinc-500">{{ c.entries.length }} games</p>
          </div>
        </NuxtLink>
        <div class="flex items-center gap-2 px-3 pb-3 text-xs">
          <span
            v-if="c.featured"
            class="rounded bg-blue-500/15 px-2 py-0.5 text-blue-400"
            >Featured</span
          >
          <span
            v-else-if="c.isPublic"
            class="rounded bg-zinc-700/40 px-2 py-0.5 text-zinc-300"
            >Public</span
          >
          <span v-else class="rounded bg-zinc-800 px-2 py-0.5 text-zinc-500"
            >Private</span
          >
          <NuxtLink
            :to="`/admin/collections/${c.id}`"
            class="ml-auto text-blue-400 hover:underline"
            >Edit</NuxtLink
          >
        </div>
      </li>
    </ul>
  </div>
</template>

<script setup lang="ts">
definePageMeta({ layout: "admin" });

interface AdminCollection {
  id: string;
  name: string;
  description: string | null;
  coverObjectId: string | null;
  featured: boolean;
  isPublic: boolean;
  entries: Array<{ gameId: string }>;
}

const collections = ref<AdminCollection[]>(
  await $dropFetch<AdminCollection[]>(
    "/api/v1/collection?includeFeatured=true",
  ),
);

const router = useRouter();
const creating = ref(false);

async function createCollection() {
  if (creating.value) return;
  creating.value = true;
  try {
    const created = await $dropFetch<{ id: string }>("/api/v1/collection", {
      method: "POST",
      body: { name: "New Collection" },
      failTitle: "Failed to create collection",
    });
    await router.push(`/admin/collections/${created.id}`);
  } finally {
    creating.value = false;
  }
}
</script>
