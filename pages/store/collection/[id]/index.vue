<template>
  <div class="w-full overflow-x-hidden">
    <div class="relative overflow-hidden bg-zinc-900">
      <!-- Cover banner + gradient -->
      <div aria-hidden="true" class="absolute inset-0">
        <div class="absolute inset-0 overflow-hidden">
          <img
            v-if="collection.coverObjectId"
            :src="useObject(collection.coverObjectId)"
            alt=""
            class="size-full object-cover"
          />
        </div>
        <div class="absolute inset-0 bg-zinc-900/75" />
        <div class="absolute inset-0 bg-linear-to-t from-zinc-900" />
      </div>

      <section
        class="relative mx-auto flex max-w-7xl flex-col items-center px-4 pt-32 pb-8 text-center sm:px-6 lg:px-8"
      >
        <div class="mx-auto max-w-2xl lg:max-w-none">
          <h2
            class="text-4xl font-bold font-display tracking-tight text-zinc-100 sm:text-5xl lg:text-6xl"
          >
            {{ collection.name }}
          </h2>
          <p
            v-if="collection.description"
            class="mx-auto line-clamp-3 mt-4 max-w-xl text-xl text-zinc-400"
          >
            {{ collection.description }}
          </p>
        </div>
      </section>
    </div>

    <div class="mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div
        v-if="collection.games.length > 0"
        class="grid gap-5 grid-cols-[repeat(auto-fill,minmax(150px,auto))]"
      >
        <GamePanel
          v-for="game in collection.games"
          :key="game.id"
          :game="game"
          :compat="compatSummary[game.id]"
          :href="`/store/${game.id}`"
        />
      </div>
      <div v-else class="flex items-start justify-center">
        <span class="uppercase text-zinc-700 font-display font-bold">{{
          $t("common.noResults")
        }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
const route = useRoute();
const collectionId = route.params.id;

const collection = await $dropFetch(`/api/v1/store/collection/${collectionId}`);

// Compat badges per game — soft-fail so the page still renders offline.
const compatSummaryRef = await useCompatSummary().catch(() => null);
const compatSummary = computed(() => compatSummaryRef?.value ?? {});

useHead({
  title: collection.name,
});
</script>
