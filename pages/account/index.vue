<template>
  <div class="max-w-3xl mx-auto space-y-10">
    <!-- Profile editing section -->
    <section>
      <h1 class="text-xl font-bold font-display text-zinc-100 mb-1">
        {{ $t("account.home.profileSection") }}
      </h1>
      <p class="text-sm text-zinc-400 mb-6">
        {{ $t("account.home.title") }}
      </p>

      <div class="space-y-5">
        <!-- Display name -->
        <div>
          <label
            for="displayName"
            class="block text-sm font-medium text-zinc-300 mb-1"
          >
            {{ $t("account.home.displayName") }}
          </label>
          <input
            id="displayName"
            v-model="displayName"
            type="text"
            maxlength="64"
            class="w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/50"
          />
        </div>

        <!-- Bio -->
        <div>
          <label for="bio" class="block text-sm font-medium text-zinc-300 mb-1">
            {{ $t("account.home.bio") }}
          </label>
          <textarea
            id="bio"
            v-model="bio"
            rows="3"
            maxlength="500"
            :placeholder="$t('account.home.bioPlaceholder')"
            class="w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/50 resize-none"
          />
        </div>

        <!-- Banner upload -->
        <div>
          <label class="block text-sm font-medium text-zinc-300 mb-2">
            {{ $t("account.home.bannerUpload") }}
          </label>
          <div
            v-if="currentUser?.bannerObjectId"
            class="relative h-28 rounded-lg overflow-hidden mb-2"
          >
            <img
              :src="useObject(currentUser.bannerObjectId)"
              class="w-full h-full object-cover"
            />
          </div>
          <input
            ref="bannerInput"
            type="file"
            accept="image/*"
            class="hidden"
            @change="uploadBanner"
          />
          <button
            class="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-sm rounded-md transition-colors"
            :disabled="bannerUploading"
            @click="($refs.bannerInput as HTMLInputElement)?.click()"
          >
            {{
              bannerUploading
                ? $t("common.srLoading")
                : $t("account.home.bannerUpload")
            }}
          </button>
        </div>

        <!-- Save button -->
        <div class="flex items-center gap-3">
          <LoadingButton
            :loading="profileSaving"
            class="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-md text-sm font-medium transition-colors"
            @click="saveProfile"
          >
            {{ $t("account.home.saveProfile") }}
          </LoadingButton>
          <span v-if="profileSaveMessage" class="text-sm text-green-400">
            {{ profileSaveMessage }}
          </span>
        </div>
      </div>
    </section>

    <!-- Showcase section (moved from separate page) -->
    <section>
      <h2 class="text-xl font-bold font-display text-zinc-100 mb-1">
        {{ $t("account.showcase.title") }}
      </h2>
      <p class="text-sm text-zinc-400 mb-6">
        {{ $t("account.showcase.description") }}
      </p>

      <!-- Current showcase slots -->
      <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
        <div
          v-for="(slot, idx) in slots"
          :key="idx"
          class="relative rounded-lg overflow-hidden bg-zinc-800/50 ring-1 ring-white/5 group"
        >
          <div class="aspect-[2/3]">
            <template v-if="slot">
              <img
                v-if="slot.game?.mCoverObjectId"
                :src="useObject(slot.game.mCoverObjectId)"
                :alt="slot.game?.mName"
                class="size-full object-cover"
              />
              <div
                v-else
                class="size-full flex items-center justify-center text-zinc-600"
              >
                <SparklesIcon class="size-8" />
              </div>
              <div
                class="absolute inset-x-0 bottom-0 bg-gradient-to-t from-zinc-950/90 to-transparent p-2"
              >
                <p class="text-xs font-medium text-zinc-200 truncate">
                  {{
                    slot.title || slot.game?.mName || $t("user.showcase.custom")
                  }}
                </p>
                <p class="text-[10px] text-zinc-400 uppercase tracking-wide">
                  {{ showcaseTypeLabels[slot.type] }}
                </p>
              </div>
              <button
                class="absolute top-1 right-1 p-1 rounded-full bg-zinc-900/80 text-zinc-400 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                @click="removeSlot(idx)"
              >
                <XMarkIcon class="size-4" />
              </button>
            </template>
            <template v-else>
              <button
                class="size-full flex flex-col items-center justify-center text-zinc-600 hover:text-zinc-400 transition-colors"
                @click="openAddDialog(idx)"
              >
                <PlusIcon class="size-6 mb-1" />
                <span class="text-xs">{{
                  $t("account.showcase.addSlot")
                }}</span>
              </button>
            </template>
          </div>
        </div>
      </div>

      <div class="flex items-center gap-3">
        <LoadingButton
          :loading="showcaseSaving"
          class="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-md text-sm font-medium transition-colors"
          @click="saveShowcase"
        >
          {{ $t("account.showcase.save") }}
        </LoadingButton>
        <span v-if="showcaseSaveMessage" class="text-sm text-green-400">
          {{ showcaseSaveMessage }}
        </span>
      </div>
    </section>

    <!-- Add showcase item dialog -->
    <TransitionRoot as="template" :show="addDialogOpen">
      <Dialog as="div" class="relative z-50" @close="addDialogOpen = false">
        <TransitionChild
          as="template"
          enter="ease-out duration-300"
          enter-from="opacity-0"
          enter-to="opacity-100"
          leave="ease-in duration-200"
          leave-from="opacity-100"
          leave-to="opacity-0"
        >
          <div class="fixed inset-0 bg-zinc-950/80 backdrop-blur-sm" />
        </TransitionChild>

        <div class="fixed inset-0 z-10 overflow-y-auto">
          <div
            class="flex min-h-full items-center justify-center p-4 text-center"
          >
            <TransitionChild
              as="template"
              enter="ease-out duration-300"
              enter-from="opacity-0 scale-95"
              enter-to="opacity-100 scale-100"
              leave="ease-in duration-200"
              leave-from="opacity-100 scale-100"
              leave-to="opacity-0 scale-95"
            >
              <DialogPanel
                class="w-full max-w-lg transform rounded-xl bg-zinc-900 p-6 text-left shadow-xl transition-all ring-1 ring-white/10"
              >
                <DialogTitle
                  class="text-lg font-bold font-display text-zinc-100 mb-4"
                >
                  {{ $t("account.showcase.addTitle") }}
                </DialogTitle>

                <!-- Type picker -->
                <div class="mb-4">
                  <label class="block text-sm font-medium text-zinc-300 mb-2">
                    {{ $t("account.showcase.type") }}
                  </label>
                  <div class="grid grid-cols-2 gap-2">
                    <button
                      v-for="st in showcaseTypes"
                      :key="st"
                      :class="[
                        'px-3 py-2 rounded-md text-sm font-medium transition-colors',
                        addType === st
                          ? 'bg-blue-600 text-white'
                          : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700',
                      ]"
                      @click="addType = st"
                    >
                      {{ showcaseTypeLabels[st] }}
                    </button>
                  </div>
                </div>

                <!-- Game picker -->
                <div
                  v-if="
                    addType === 'FavoriteGame' ||
                    addType === 'GameStats' ||
                    addType === 'Achievement'
                  "
                  class="mb-4"
                >
                  <label class="block text-sm font-medium text-zinc-300 mb-2">
                    {{ $t("account.showcase.selectGame") }}
                  </label>
                  <input
                    v-model="gameSearch"
                    type="text"
                    :placeholder="$t('store.search.placeholder')"
                    class="w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/50 mb-2"
                  />
                  <div class="max-h-48 overflow-y-auto space-y-1">
                    <button
                      v-for="game in filteredGames"
                      :key="game.id"
                      :class="[
                        'flex items-center gap-2 w-full p-2 rounded text-left text-sm transition-colors',
                        addGameId === game.id
                          ? 'bg-blue-600/20 ring-1 ring-blue-500'
                          : 'hover:bg-zinc-800',
                      ]"
                      @click="addGameId = game.id"
                    >
                      <img
                        v-if="game.mIconObjectId"
                        :src="useObject(game.mIconObjectId)"
                        class="size-6 rounded"
                      />
                      <span class="text-zinc-200 truncate">
                        {{ game.mName }}
                      </span>
                    </button>
                    <p
                      v-if="filteredGames.length === 0"
                      class="text-sm text-zinc-500 p-2"
                    >
                      {{ $t("store.search.noResults") }}
                    </p>
                  </div>
                </div>

                <!-- Custom title -->
                <div v-if="addType === 'Custom'" class="mb-4">
                  <label class="block text-sm font-medium text-zinc-300 mb-2">
                    {{ $t("account.showcase.customTitle") }}
                  </label>
                  <input
                    v-model="addTitle"
                    type="text"
                    maxlength="64"
                    class="w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/50"
                  />
                </div>

                <!-- Actions -->
                <div class="flex justify-end gap-2 mt-6">
                  <button
                    class="px-4 py-2 rounded-md text-sm text-zinc-300 hover:text-zinc-100 transition-colors"
                    @click="addDialogOpen = false"
                  >
                    {{ $t("cancel") }}
                  </button>
                  <button
                    :disabled="!canAdd"
                    :class="[
                      'px-4 py-2 rounded-md text-sm font-medium transition-colors',
                      canAdd
                        ? 'bg-blue-600 hover:bg-blue-500 text-white'
                        : 'bg-zinc-700 text-zinc-500 cursor-not-allowed',
                    ]"
                    @click="confirmAdd"
                  >
                    {{ $t("account.showcase.add") }}
                  </button>
                </div>
              </DialogPanel>
            </TransitionChild>
          </div>
        </div>
      </Dialog>
    </TransitionRoot>
  </div>
</template>

<script setup lang="ts">
import { SparklesIcon, XMarkIcon, PlusIcon } from "@heroicons/vue/24/outline";
import {
  Dialog,
  DialogPanel,
  DialogTitle,
  TransitionChild,
  TransitionRoot,
} from "@headlessui/vue";
import { useObject } from "~/composables/objects";
import { useUser, updateUser } from "~/composables/user";
import type { ShowcaseType } from "~/prisma/client/enums";

const { t } = useI18n();
useHead({ title: t("account.home.profileSection") });

// ── Profile editing ─────────────────────────────────────────────────────────

const currentUser = useUser();
const displayName = ref(currentUser.value?.displayName ?? "");
const bio = ref(currentUser.value?.bio ?? "");
const profileSaving = ref(false);
const profileSaveMessage = ref("");
const bannerUploading = ref(false);

async function saveProfile() {
  profileSaving.value = true;
  profileSaveMessage.value = "";
  try {
    await $dropFetch("/api/v1/user/profile", {
      method: "PATCH",
      body: { displayName: displayName.value, bio: bio.value },
    });
    await updateUser();
    profileSaveMessage.value = t("account.home.profileSaved");
    setTimeout(() => {
      profileSaveMessage.value = "";
    }, 3000);
  } finally {
    profileSaving.value = false;
  }
}

async function uploadBanner(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  bannerUploading.value = true;
  try {
    const form = new FormData();
    form.append("file", file);
    await $dropFetch("/api/v1/user/banner", { method: "POST", body: form });
    await updateUser();
  } finally {
    bannerUploading.value = false;
  }
}

// ── Showcase ────────────────────────────────────────────────────────────────

const MAX_SLOTS = 6;

const showcaseTypeLabels = computed<Record<string, string>>(() => ({
  Achievement: t("user.showcase.types.Achievement"),
  Custom: t("user.showcase.types.Custom"),
  FavoriteGame: t("user.showcase.types.FavoriteGame"),
  GameStats: t("user.showcase.types.GameStats"),
}));
const showcaseTypes: ShowcaseType[] = [
  "FavoriteGame",
  "Achievement",
  "GameStats",
  "Custom",
];

// Fetch current showcase
const currentShowcase = currentUser.value?.id
  ? await $dropFetch(`/api/v1/user/${currentUser.value.id}/showcase`).catch(
      () => null,
    )
  : null;

type ShowcaseItem = {
  type: ShowcaseType;
  gameId: string | null;
  itemId: string | null;
  title: string;
  data: unknown;
  game?: {
    id: string;
    mName: string;
    mIconObjectId: string;
    mCoverObjectId: string;
  } | null;
};

const slots = ref<(ShowcaseItem | null)[]>(
  Array.from({ length: MAX_SLOTS }, (_, i) =>
    currentShowcase?.items?.[i] ? { ...currentShowcase.items[i] } : null,
  ),
);

// Games for the picker
const allGames = await $dropFetch<{
  results: Array<{
    id: string;
    mName: string;
    mIconObjectId: string;
    mCoverObjectId: string;
  }>;
}>("/api/v1/store", {
  query: { sort: "name", order: "asc", limit: "200" },
}).catch(() => ({ results: [] }));

const gameSearch = ref("");
const filteredGames = computed(() => {
  const q = gameSearch.value.toLowerCase();
  const games = allGames?.results ?? [];
  if (!q) return games.slice(0, 20);
  return games.filter((g) => g.mName.toLowerCase().includes(q)).slice(0, 20);
});

// Add dialog state
const addDialogOpen = ref(false);
const addSlotIndex = ref(0);
const addType = ref<ShowcaseType>("FavoriteGame");
const addGameId = ref<string | null>(null);
const addTitle = ref("");

function openAddDialog(idx: number) {
  addSlotIndex.value = idx;
  addType.value = "FavoriteGame";
  addGameId.value = null;
  addTitle.value = "";
  gameSearch.value = "";
  addDialogOpen.value = true;
}

const canAdd = computed(() => {
  if (
    addType.value === "FavoriteGame" ||
    addType.value === "GameStats" ||
    addType.value === "Achievement"
  ) {
    return !!addGameId.value;
  }
  if (addType.value === "Custom") {
    return addTitle.value.trim().length > 0;
  }
  return true;
});

function confirmAdd() {
  if (!canAdd.value) return;
  const game = allGames?.results?.find((g) => g.id === addGameId.value) ?? null;
  slots.value[addSlotIndex.value] = {
    type: addType.value,
    gameId: addGameId.value,
    itemId: null,
    title: addTitle.value || game?.mName || "",
    data: null,
    game: game
      ? {
          id: game.id,
          mName: game.mName,
          mIconObjectId: game.mIconObjectId,
          mCoverObjectId: game.mCoverObjectId,
        }
      : null,
  };
  addDialogOpen.value = false;
}

function removeSlot(idx: number) {
  slots.value[idx] = null;
}

// Save showcase
const showcaseSaving = ref(false);
const showcaseSaveMessage = ref("");

async function saveShowcase() {
  showcaseSaving.value = true;
  showcaseSaveMessage.value = "";
  try {
    const items = slots.value
      .filter((s): s is ShowcaseItem => s !== null)
      .map((s) => ({
        type: s.type,
        gameId: s.gameId,
        itemId: s.itemId,
        title: s.title,
        data: s.data,
      }));
    await $dropFetch("/api/v1/user/showcase", {
      method: "PUT",
      body: { items },
    });
    showcaseSaveMessage.value = t("account.showcase.saved");
    setTimeout(() => {
      showcaseSaveMessage.value = "";
    }, 3000);
  } finally {
    showcaseSaving.value = false;
  }
}
</script>
