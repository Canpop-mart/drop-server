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

        <!-- Profile picture upload -->
        <div>
          <label class="block text-sm font-medium text-zinc-300 mb-2">
            {{ $t("account.home.avatarUpload") }}
          </label>
          <div class="flex items-center gap-4 mb-2">
            <img
              v-if="currentUser?.profilePictureObjectId"
              :src="useObject(currentUser.profilePictureObjectId)"
              class="size-20 rounded-full object-cover border-2 border-zinc-700"
            />
            <div
              v-else
              class="size-20 rounded-full bg-zinc-700 border-2 border-zinc-700"
            />
            <div>
              <input
                ref="avatarInput"
                type="file"
                accept="image/*"
                class="hidden"
                @change="uploadAvatar"
              />
              <button
                class="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-sm rounded-md transition-colors"
                :disabled="avatarUploading"
                @click="($refs.avatarInput as HTMLInputElement)?.click()"
              >
                {{
                  avatarUploading
                    ? $t("common.srLoading")
                    : $t("account.home.avatarUpload")
                }}
              </button>
            </div>
          </div>
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

        <!-- Profile Theme -->
        <div>
          <label class="block text-sm font-medium text-zinc-300 mb-2">
            {{ $t("account.home.profileTheme") }}
          </label>
          <div class="grid grid-cols-4 sm:grid-cols-6 gap-2">
            <button
              v-for="theme in profileThemes"
              :key="theme.id"
              :class="[
                'flex flex-col items-center gap-1 p-2 rounded-lg border-2 transition-all',
                selectedTheme === theme.id
                  ? 'border-blue-500 bg-zinc-800'
                  : 'border-transparent hover:border-zinc-600 bg-zinc-800/50',
              ]"
              @click="selectedTheme = theme.id"
            >
              <div
                class="w-full h-6 rounded"
                :style="{
                  background: `linear-gradient(135deg, ${theme.from}, ${theme.to})`,
                }"
              />
              <span class="text-[10px] text-zinc-400">
                {{ theme.label }}
              </span>
            </button>
          </div>
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

    <!-- Favorite Games section -->
    <section>
      <h2 class="text-xl font-bold font-display text-zinc-100 mb-1">
        {{ $t("account.favorites.title") }}
      </h2>
      <p class="text-sm text-zinc-400 mb-6">
        {{ $t("account.favorites.description") }}
      </p>

      <div class="flex gap-3 flex-wrap mb-4">
        <div
          v-for="(fav, idx) in favoriteGames"
          :key="fav.id"
          class="relative group"
        >
          <div class="w-20 rounded-lg overflow-hidden ring-1 ring-white/5">
            <div class="aspect-[2/3]">
              <img
                v-if="fav.mCoverObjectId"
                :src="useObject(fav.mCoverObjectId)"
                :alt="fav.mName"
                class="size-full object-cover"
              />
              <div
                v-else
                class="size-full bg-zinc-800 flex items-center justify-center text-zinc-600"
              >
                <SparklesIcon class="size-5" />
              </div>
            </div>
          </div>
          <p class="text-xs text-zinc-400 text-center mt-1 truncate w-20">
            {{ fav.mName }}
          </p>
          <button
            class="absolute -top-1 -right-1 p-0.5 rounded-full bg-zinc-900/80 text-zinc-400 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
            @click="removeFavorite(idx)"
          >
            <XMarkIcon class="size-4" />
          </button>
        </div>
      </div>

      <!-- Add favorite game picker -->
      <div class="flex gap-2 items-start mb-4">
        <div class="flex-1">
          <input
            v-model="favSearch"
            type="text"
            :placeholder="$t('account.favorites.searchPlaceholder')"
            class="w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/50"
            @focus="favDropdownOpen = true"
          />
          <div
            v-if="favDropdownOpen && favFilteredGames.length > 0"
            class="mt-1 max-h-40 overflow-y-auto rounded-md border border-zinc-700 bg-zinc-800"
          >
            <button
              v-for="game in favFilteredGames"
              :key="game.id"
              class="flex items-center gap-2 w-full p-2 text-left text-sm hover:bg-zinc-700 transition-colors"
              @click="addFavorite(game)"
            >
              <img
                v-if="game.mIconObjectId"
                :src="useObject(game.mIconObjectId)"
                class="size-5 rounded"
              />
              <span class="text-zinc-200 truncate">{{ game.mName }}</span>
            </button>
          </div>
        </div>
      </div>

      <div class="flex items-center gap-3">
        <LoadingButton
          :loading="favSaving"
          class="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-md text-sm font-medium transition-colors"
          @click="saveFavorites"
        >
          {{ $t("account.favorites.save") }}
        </LoadingButton>
        <span v-if="favSaveMessage" class="text-sm text-green-400">
          {{ favSaveMessage }}
        </span>
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

                <!-- Achievement picker (step 2 after game selection) -->
                <div v-if="addType === 'Achievement' && addGameId" class="mb-4">
                  <label class="block text-sm font-medium text-zinc-300 mb-2">
                    {{ $t("account.showcase.selectAchievement") }}
                  </label>
                  <div
                    v-if="achievementsLoading"
                    class="text-sm text-zinc-500 p-2"
                  >
                    {{ $t("common.srLoading") }}
                  </div>
                  <div v-else class="max-h-48 overflow-y-auto space-y-1">
                    <button
                      v-for="ach in gameAchievements"
                      :key="ach.id"
                      :class="[
                        'flex items-center gap-2 w-full p-2 rounded text-left text-sm transition-colors',
                        addItemId === ach.id
                          ? 'bg-blue-600/20 ring-1 ring-blue-500'
                          : 'hover:bg-zinc-800',
                      ]"
                      @click="addItemId = ach.id"
                    >
                      <img
                        v-if="ach.iconUrl"
                        :src="ach.iconUrl"
                        class="size-6 rounded"
                      />
                      <div class="flex-1 min-w-0">
                        <span class="text-zinc-200 truncate block">
                          {{ ach.title }}
                        </span>
                        <span
                          v-if="ach.description"
                          class="text-xs text-zinc-500 truncate block"
                        >
                          {{ ach.description }}
                        </span>
                      </div>
                    </button>
                    <p
                      v-if="gameAchievements.length === 0"
                      class="text-sm text-zinc-500 p-2"
                    >
                      {{ $t("account.showcase.noAchievements") }}
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
const avatarUploading = ref(false);

const profileThemes = [
  { id: "default", label: "Default", from: "#1e3a5f", to: "#581c87" },
  { id: "ocean", label: "Ocean", from: "#0c4a6e", to: "#164e63" },
  { id: "sunset", label: "Sunset", from: "#9a3412", to: "#831843" },
  { id: "forest", label: "Forest", from: "#14532d", to: "#1a2e05" },
  { id: "ember", label: "Ember", from: "#7c2d12", to: "#451a03" },
  { id: "arctic", label: "Arctic", from: "#0e7490", to: "#1e40af" },
  { id: "midnight", label: "Midnight", from: "#1e1b4b", to: "#0f172a" },
  { id: "rose", label: "Rose", from: "#9f1239", to: "#4c0519" },
];
const selectedTheme = ref(currentUser.value?.profileTheme ?? "default");

async function saveProfile() {
  profileSaving.value = true;
  profileSaveMessage.value = "";
  try {
    await $dropFetch("/api/v1/user/profile", {
      method: "PATCH",
      body: {
        displayName: displayName.value,
        bio: bio.value,
        profileTheme: selectedTheme.value,
      },
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

async function uploadAvatar(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  avatarUploading.value = true;
  try {
    const form = new FormData();
    form.append("file", file);
    await $dropFetch("/api/v1/user/avatar", { method: "POST", body: form });
    await updateUser();
  } finally {
    avatarUploading.value = false;
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

// ── Shared: games for pickers ──────────────────────────────────────────────
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

// ── Favorites ──────────────────────────────────────────────────────────────

type FavGame = {
  id: string;
  mName: string;
  mCoverObjectId?: string;
  mIconObjectId?: string;
};

const currentFavorites = currentUser.value?.id
  ? await $dropFetch<Array<{ gameId: string; game: FavGame | null }>>(
      `/api/v1/user/${currentUser.value.id}/favorites`,
    ).catch(() => [])
  : [];

const favoriteGames = ref<FavGame[]>(
  (currentFavorites ?? []).filter((f) => f.game).map((f) => f.game as FavGame),
);

const favSearch = ref("");
const favDropdownOpen = ref(false);
const favSaving = ref(false);
const favSaveMessage = ref("");

const favFilteredGames = computed(() => {
  const q = favSearch.value.toLowerCase();
  if (!q) return [];
  const currentIds = new Set(favoriteGames.value.map((g) => g.id));
  return (allGames?.results ?? [])
    .filter((g) => g.mName.toLowerCase().includes(q) && !currentIds.has(g.id))
    .slice(0, 10);
});

function addFavorite(game: FavGame) {
  if (favoriteGames.value.length >= 10) return;
  if (favoriteGames.value.some((g) => g.id === game.id)) return;
  favoriteGames.value.push(game);
  favSearch.value = "";
  favDropdownOpen.value = false;
}

function removeFavorite(idx: number) {
  favoriteGames.value.splice(idx, 1);
}

async function saveFavorites() {
  favSaving.value = true;
  favSaveMessage.value = "";
  try {
    await $dropFetch("/api/v1/user/favorites", {
      method: "PUT",
      body: { gameIds: favoriteGames.value.map((g) => g.id) },
    });
    favSaveMessage.value = t("account.favorites.saved");
    setTimeout(() => {
      favSaveMessage.value = "";
    }, 3000);
  } finally {
    favSaving.value = false;
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
const addItemId = ref<string | null>(null);
const addTitle = ref("");

// Achievement picker for Achievement showcase type
type AchievementOption = {
  id: string;
  title: string;
  description?: string;
  iconUrl?: string;
};
const gameAchievements = ref<AchievementOption[]>([]);
const achievementsLoading = ref(false);

watch(
  () => [addGameId.value, addType.value] as const,
  async ([gameId, type]) => {
    gameAchievements.value = [];
    addItemId.value = null;
    if (type !== "Achievement" || !gameId) return;
    achievementsLoading.value = true;
    try {
      const data = await $dropFetch<AchievementOption[]>(
        `/api/v1/games/${gameId}/achievements`,
      );
      gameAchievements.value = data ?? [];
    } catch {
      gameAchievements.value = [];
    } finally {
      achievementsLoading.value = false;
    }
  },
);

function openAddDialog(idx: number) {
  addSlotIndex.value = idx;
  addType.value = "FavoriteGame";
  addGameId.value = null;
  addItemId.value = null;
  addTitle.value = "";
  gameSearch.value = "";
  gameAchievements.value = [];
  addDialogOpen.value = true;
}

const canAdd = computed(() => {
  if (addType.value === "Achievement") {
    return !!addGameId.value && !!addItemId.value;
  }
  if (addType.value === "FavoriteGame" || addType.value === "GameStats") {
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
  const ach = gameAchievements.value.find((a) => a.id === addItemId.value);
  slots.value[addSlotIndex.value] = {
    type: addType.value,
    gameId: addGameId.value,
    itemId: addItemId.value,
    title:
      addTitle.value ||
      (addType.value === "Achievement" && ach ? ach.title : "") ||
      game?.mName ||
      "",
    data:
      addType.value === "Achievement" && ach
        ? { iconUrl: ach.iconUrl, description: ach.description }
        : null,
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
