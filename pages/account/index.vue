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
              <p v-if="avatarError" class="mt-2 text-sm text-red-400">
                {{ avatarError }}
              </p>
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
          <p v-if="bannerError" class="mt-2 text-sm text-red-400">
            {{ bannerError }}
          </p>
        </div>

        <!-- Profile Theme -->
        <div>
          <label class="block text-sm font-medium text-zinc-300 mb-2">
            {{ $t("account.home.profileTheme") }}
          </label>
          <div class="grid grid-cols-5 gap-2">
            <button
              v-for="theme in PROFILE_THEME_PRESETS"
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
            <!-- Custom colour -->
            <label
              :class="[
                'relative flex flex-col items-center gap-1 p-2 rounded-lg border-2 transition-all cursor-pointer',
                customThemeSelected
                  ? 'border-blue-500 bg-zinc-800'
                  : 'border-transparent hover:border-zinc-600 bg-zinc-800/50',
              ]"
            >
              <div
                class="w-full h-6 rounded"
                :style="{
                  background: customThemeSelected
                    ? `linear-gradient(135deg, ${customGradient.from}, ${customGradient.to})`
                    : 'conic-gradient(from 0deg, #ef4444, #f59e0b, #22c55e, #06b6d4, #3b82f6, #a855f7, #ef4444)',
                }"
              />
              <span class="text-[10px] text-zinc-400">
                {{
                  customThemeSelected
                    ? selectedTheme
                    : $t("account.home.customTheme")
                }}
              </span>
              <input
                type="color"
                :value="customColour"
                class="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                @input="onCustomColour"
              />
            </label>
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
          <span v-if="profileSaveError" class="text-sm text-red-400">
            {{ profileSaveError }}
          </span>
          <span v-else-if="profileSaveMessage" class="text-sm text-green-400">
            {{ profileSaveMessage }}
          </span>
        </div>
      </div>
    </section>

    <!-- Showcase could not be loaded: no editor, because saving would replace
         the stored showcase with empty slots. -->
    <section v-if="showcaseLoadFailed">
      <h2 class="text-xl font-bold font-display text-zinc-100 mb-1">
        {{ $t("account.showcase.title") }}
      </h2>
      <p v-if="showcaseSaveMessage" class="text-sm text-green-400 mb-2">
        {{ showcaseSaveMessage }}
      </p>
      <p class="text-sm text-red-400">
        {{ $t("account.showcase.loadFailed") }}
      </p>
    </section>

    <template v-else>
      <!-- Game Showcase -->
      <section>
        <h2 class="text-xl font-bold font-display text-zinc-100 mb-1">
          {{ $t("account.showcase.gameTitle") }}
        </h2>
        <p class="text-sm text-zinc-400 mb-6">
          {{ $t("account.showcase.gameDescription") }}
        </p>

        <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
          <div
            v-for="(slot, idx) in gameSlots"
            :key="'game-' + idx"
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
                    {{ slot.game?.mName || slot.title }}
                  </p>
                </div>
                <button
                  class="absolute top-1 right-1 p-1 rounded-full bg-zinc-900/80 text-zinc-400 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                  @click="removeGameSlot(idx)"
                >
                  <XMarkIcon class="size-4" />
                </button>
              </template>
              <template v-else>
                <button
                  class="size-full flex flex-col items-center justify-center text-zinc-600 hover:text-zinc-400 transition-colors"
                  @click="openGameAddDialog(idx)"
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
      </section>

      <!-- Achievement Showcase -->
      <section>
        <h2 class="text-xl font-bold font-display text-zinc-100 mb-1">
          {{ $t("account.showcase.achievementTitle") }}
        </h2>
        <p class="text-sm text-zinc-400 mb-6">
          {{ $t("account.showcase.achievementDescription") }}
        </p>

        <div class="grid grid-cols-2 gap-2 mb-6">
          <div
            v-for="(slot, idx) in achievementSlots"
            :key="'ach-' + idx"
            class="relative rounded-lg bg-zinc-800/50 ring-1 ring-white/5 group"
          >
            <template v-if="slot">
              <div class="flex items-center gap-3 p-3">
                <div
                  class="shrink-0 size-12 rounded-lg overflow-hidden bg-zinc-700/50 flex items-center justify-center"
                >
                  <img
                    v-if="slot.data?.iconUrl"
                    :src="String(slot.data.iconUrl)"
                    class="size-full object-cover"
                  />
                  <TrophyIcon v-else class="size-6 text-yellow-500" />
                </div>
                <div class="min-w-0 flex-1">
                  <p class="text-sm font-semibold text-zinc-100 truncate">
                    {{ slot.title }}
                  </p>
                  <p class="text-xs text-zinc-400 truncate">
                    {{ slot.game?.mName }}
                  </p>
                </div>
              </div>
              <button
                class="absolute top-1 right-1 p-1 rounded-full bg-zinc-900/80 text-zinc-400 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                @click="removeAchievementSlot(idx)"
              >
                <XMarkIcon class="size-4" />
              </button>
            </template>
            <template v-else>
              <button
                class="w-full flex items-center justify-center gap-2 p-3 text-zinc-600 hover:text-zinc-400 transition-colors"
                @click="openAchievementAddDialog(idx)"
              >
                <PlusIcon class="size-5" />
                <span class="text-xs">{{
                  $t("account.showcase.addSlot")
                }}</span>
              </button>
            </template>
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
          <span v-if="showcaseSaveError" class="text-sm text-red-400">
            {{ showcaseSaveError }}
          </span>
          <span v-else-if="showcaseSaveMessage" class="text-sm text-green-400">
            {{ showcaseSaveMessage }}
          </span>
        </div>
      </section>
    </template>

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
                  {{
                    addType === "Achievement"
                      ? $t("account.showcase.addAchievement")
                      : $t("account.showcase.addGame")
                  }}
                </DialogTitle>

                <!-- Game picker (shared between both modes) -->
                <div class="mb-4">
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
                      v-for="game in pickerGames"
                      :key="game.id"
                      :class="[
                        'flex items-center gap-2 w-full p-2 rounded text-left text-sm transition-colors',
                        addGameId === game.id
                          ? 'bg-blue-600/20 ring-1 ring-blue-500'
                          : 'hover:bg-zinc-800',
                      ]"
                      @click="addGame = game"
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
                    <div
                      v-if="pickerFailed"
                      class="flex items-center gap-3 p-2 text-sm text-red-400"
                    >
                      <span>{{ $t("account.showcase.gamesLoadFailed") }}</span>
                      <button
                        class="text-zinc-300 underline hover:text-zinc-100"
                        @click="loadPickerGames"
                      >
                        {{ $t("account.showcase.retry") }}
                      </button>
                    </div>
                    <p
                      v-else-if="pickerLoading && pickerGames.length === 0"
                      class="text-sm text-zinc-500 p-2"
                    >
                      {{ $t("common.srLoading") }}
                    </p>
                    <p
                      v-else-if="pickerGames.length === 0"
                      class="text-sm text-zinc-500 p-2"
                    >
                      {{ $t("store.search.noResults") }}
                    </p>
                    <p
                      v-else-if="pickerCount > pickerGames.length"
                      class="text-xs text-zinc-500 p-2"
                    >
                      {{
                        $t("account.showcase.moreGames", {
                          shown: pickerGames.length,
                          total: pickerCount,
                        })
                      }}
                    </p>
                  </div>
                </div>

                <!-- Achievement picker (only in achievement mode) -->
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
                  <div
                    v-else-if="achievementsFailed"
                    class="flex items-center gap-3 p-2 text-sm text-red-400"
                  >
                    <span>{{
                      $t("account.showcase.achievementsLoadFailed")
                    }}</span>
                    <button
                      class="text-zinc-300 underline hover:text-zinc-100"
                      @click="loadAchievements"
                    >
                      {{ $t("account.showcase.retry") }}
                    </button>
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
import { TrophyIcon } from "@heroicons/vue/24/solid";
import {
  Dialog,
  DialogPanel,
  DialogTitle,
  TransitionChild,
  TransitionRoot,
} from "@headlessui/vue";
import type { Ref } from "vue";
import { useObject } from "~/composables/objects";
import { useUser, updateUser } from "~/composables/user";
import type { ShowcaseType } from "~/prisma/client/enums";
import {
  MAX_SHOWCASE_ITEMS,
  mergeShowcase,
  untouchedCount,
  type ShowcaseEntry,
} from "~/composables/showcase-merge";
import {
  PROFILE_THEME_PRESETS,
  isCustomProfileTheme,
  normalizeProfileTheme,
  resolveAccentHex,
  resolveThemeGradient,
} from "~/server/internal/utils/profile-themes";

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

const profileSaveError = ref("");
const avatarError = ref("");
const bannerError = ref("");

/** The server's reason for a failed $dropFetch, else the error's own text. */
function errorReason(e: unknown): string {
  const err = e as {
    statusMessage?: string;
    data?: { statusMessage?: string };
    message?: string;
  };
  return (
    err?.data?.statusMessage ?? err?.statusMessage ?? err?.message ?? String(e)
  );
}

const selectedTheme = ref(currentUser.value?.profileTheme ?? "default");
const customThemeSelected = computed(() =>
  isCustomProfileTheme(selectedTheme.value),
);
const customGradient = computed(() =>
  resolveThemeGradient(selectedTheme.value),
);
const customColour = ref(resolveAccentHex(selectedTheme.value));

function onCustomColour(e: Event) {
  const hex = normalizeProfileTheme((e.target as HTMLInputElement).value);
  if (!hex) return;
  customColour.value = hex;
  selectedTheme.value = hex;
}

async function saveProfile() {
  profileSaving.value = true;
  profileSaveMessage.value = "";
  profileSaveError.value = "";
  try {
    // Every field is sent as-is: an empty bio is how the bio gets cleared.
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
  } catch (e) {
    profileSaveError.value = t("account.home.profileSaveFailed", {
      reason: errorReason(e),
    });
  } finally {
    profileSaving.value = false;
  }
}

async function uploadImage(
  e: Event,
  path: "/api/v1/user/avatar" | "/api/v1/user/banner",
  uploading: Ref<boolean>,
  error: Ref<string>,
) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  uploading.value = true;
  error.value = "";
  try {
    const form = new FormData();
    form.append("file", file);
    await $dropFetch(path, { method: "POST", body: form });
    await updateUser();
  } catch (err) {
    error.value = t("account.home.uploadFailed", { reason: errorReason(err) });
  } finally {
    uploading.value = false;
    // Let the same file be picked again after a failure.
    input.value = "";
  }
}

function uploadAvatar(e: Event) {
  return uploadImage(e, "/api/v1/user/avatar", avatarUploading, avatarError);
}

function uploadBanner(e: Event) {
  return uploadImage(e, "/api/v1/user/banner", bannerUploading, bannerError);
}

// ── Shared: games for pickers ──────────────────────────────────────────────
// Searched on the server, so every game in the store can be found, not just
// the first page.

type PickerGame = {
  id: string;
  mName: string;
  mIconObjectId: string;
  mCoverObjectId: string;
};

const PICKER_PAGE = 50;
const pickerGames = ref<PickerGame[]>([]);
const pickerCount = ref(0);
const pickerLoading = ref(false);
const pickerFailed = ref(false);
let pickerSeq = 0;

async function loadPickerGames() {
  const q = gameSearch.value.trim();
  // Newer searches win; an older response arriving late is dropped.
  const seq = ++pickerSeq;
  pickerLoading.value = true;
  pickerFailed.value = false;
  try {
    const res = await $dropFetch<{ results: PickerGame[]; count: number }>(
      "/api/v1/store",
      {
        query: {
          sort: "name",
          order: "asc",
          take: String(PICKER_PAGE),
          ...(q ? { q } : {}),
        },
      },
    );
    if (seq !== pickerSeq) return;
    pickerGames.value = res.results ?? [];
    pickerCount.value = res.count ?? pickerGames.value.length;
  } catch {
    if (seq !== pickerSeq) return;
    pickerGames.value = [];
    pickerFailed.value = true;
  } finally {
    if (seq === pickerSeq) pickerLoading.value = false;
  }
}

// ── Showcase ────────────────────────────────────────────────────────────────

const MAX_SLOTS = 6;

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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any;
  game?: {
    id: string;
    mName: string;
    mIconObjectId: string;
    mCoverObjectId: string;
  } | null;
};

// Without the stored showcase the slots would start empty, and saving would
// replace the real showcase with them.
const showcaseLoadFailed = ref(!!currentUser.value?.id && !currentShowcase);

const ACHIEVEMENT_SLOTS = 6;
const gameSlots = ref<(ShowcaseItem | null)[]>([]);
const achievementSlots = ref<(ShowcaseItem | null)[]>([]);
// The showcase as the server last returned it. Saving merges the slot edits
// back into it so items these slots don't show survive (showcase-merge.ts).
const storedShowcase = ref<ShowcaseEntry[]>([]);

function toEntry(item: ShowcaseEntry): ShowcaseEntry {
  return {
    type: item.type,
    gameId: item.gameId ?? null,
    itemId: item.itemId ?? null,
    title: item.title ?? "",
    data: item.data ?? null,
  };
}

/** Fill the slots with the same window of `stored` that the save merge assumes. */
function applyStoredShowcase(stored: ShowcaseItem[]) {
  storedShowcase.value = stored.map(toEntry);
  const games = stored.filter((i) => i.type === "FavoriteGame");
  const achs = stored.filter((i) => i.type === "Achievement");
  gameSlots.value = Array.from({ length: MAX_SLOTS }, (_, i) =>
    games[i] ? { ...games[i] } : null,
  );
  achievementSlots.value = Array.from({ length: ACHIEVEMENT_SLOTS }, (_, i) =>
    achs[i] ? { ...achs[i] } : null,
  );
}
applyStoredShowcase((currentShowcase?.items ?? []) as ShowcaseItem[]);

const gameSearch = ref("");
let gameSearchTimer: ReturnType<typeof setTimeout> | null = null;
watch(gameSearch, () => {
  if (gameSearchTimer) clearTimeout(gameSearchTimer);
  gameSearchTimer = setTimeout(loadPickerGames, 300);
});
onBeforeUnmount(() => {
  if (gameSearchTimer) clearTimeout(gameSearchTimer);
});

// Add dialog state
const addDialogOpen = ref(false);
const addSlotIndex = ref(0);
const addType = ref<ShowcaseType>("FavoriteGame");
// The picked game itself, not its id: a new search replaces the list.
const addGame = ref<PickerGame | null>(null);
const addGameId = computed(() => addGame.value?.id ?? null);
const addItemId = ref<string | null>(null);

// Achievement picker
type AchievementOption = {
  id: string;
  title: string;
  description?: string;
  iconUrl?: string;
  unlocked?: boolean;
};
const gameAchievements = ref<AchievementOption[]>([]);
const achievementsLoading = ref(false);
const achievementsFailed = ref(false);

async function loadAchievements() {
  const gameId = addGameId.value;
  gameAchievements.value = [];
  addItemId.value = null;
  achievementsFailed.value = false;
  if (addType.value !== "Achievement" || !gameId) {
    achievementsLoading.value = false;
    return;
  }
  achievementsLoading.value = true;
  try {
    const data = await $dropFetch<AchievementOption[]>(
      `/api/v1/games/${gameId}/achievements`,
    );
    if (addGameId.value !== gameId) return;
    // Only unlocked ones: the server refuses to showcase anything else.
    gameAchievements.value = (data ?? []).filter((a) => a.unlocked);
  } catch {
    if (addGameId.value === gameId) achievementsFailed.value = true;
  } finally {
    if (addGameId.value === gameId) achievementsLoading.value = false;
  }
}

watch(() => [addGameId.value, addType.value] as const, loadAchievements);

// The server stores at most MAX_SHOWCASE_ITEMS, including items these slots
// don't show. Adding past that would only fail on save.
const showcaseFull = computed(() => {
  const filled =
    gameSlots.value.filter(Boolean).length +
    achievementSlots.value.filter(Boolean).length;
  return (
    filled +
      untouchedCount(storedShowcase.value, MAX_SLOTS, ACHIEVEMENT_SLOTS) >=
    MAX_SHOWCASE_ITEMS
  );
});

function refuseIfFull(): boolean {
  if (!showcaseFull.value) return false;
  showcaseSaveMessage.value = "";
  showcaseSaveError.value = t("account.showcase.full", {
    max: MAX_SHOWCASE_ITEMS,
  });
  return true;
}

function openGameAddDialog(idx: number) {
  if (refuseIfFull()) return;
  addSlotIndex.value = idx;
  addType.value = "FavoriteGame";
  addGame.value = null;
  addItemId.value = null;
  gameSearch.value = "";
  gameAchievements.value = [];
  addDialogOpen.value = true;
  loadPickerGames();
}

function openAchievementAddDialog(idx: number) {
  if (refuseIfFull()) return;
  addSlotIndex.value = idx;
  addType.value = "Achievement";
  addGame.value = null;
  addItemId.value = null;
  gameSearch.value = "";
  gameAchievements.value = [];
  addDialogOpen.value = true;
  loadPickerGames();
}

const canAdd = computed(() => {
  if (addType.value === "Achievement") {
    return !!addGameId.value && !!addItemId.value;
  }
  return !!addGameId.value;
});

function confirmAdd() {
  if (!canAdd.value) return;
  const game = addGame.value;
  const ach = gameAchievements.value.find((a) => a.id === addItemId.value);

  const item: ShowcaseItem = {
    type: addType.value,
    gameId: addGameId.value,
    itemId: addItemId.value,
    title:
      addType.value === "Achievement" && ach ? ach.title : game?.mName || "",
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

  if (addType.value === "FavoriteGame") {
    gameSlots.value[addSlotIndex.value] = item;
  } else {
    achievementSlots.value[addSlotIndex.value] = item;
  }
  addDialogOpen.value = false;
}

function removeGameSlot(idx: number) {
  gameSlots.value[idx] = null;
}

function removeAchievementSlot(idx: number) {
  achievementSlots.value[idx] = null;
}

// Save showcase
const showcaseSaving = ref(false);
const showcaseSaveMessage = ref("");
const showcaseSaveError = ref("");

async function saveShowcase() {
  if (showcaseLoadFailed.value) return;
  showcaseSaving.value = true;
  showcaseSaveMessage.value = "";
  showcaseSaveError.value = "";
  try {
    const gameItems = gameSlots.value
      .filter((s): s is ShowcaseItem => s !== null)
      .map((s) => ({
        type: s.type,
        gameId: s.gameId,
        itemId: s.itemId,
        title: s.title,
        data: s.data,
      }));
    const achItems = achievementSlots.value
      .filter((s): s is ShowcaseItem => s !== null)
      .map((s) => ({
        type: s.type,
        gameId: s.gameId,
        itemId: s.itemId,
        title: s.title,
        data: s.data,
      }));
    const items = mergeShowcase(
      storedShowcase.value,
      gameItems,
      achItems,
      MAX_SLOTS,
      ACHIEVEMENT_SLOTS,
    );
    await $dropFetch("/api/v1/user/showcase", {
      method: "PUT",
      body: { items },
    });
    // Re-read what is stored so the slots show the window the next save will
    // merge into. The PUT response has no cover art, so fetch the full view.
    // If that fails, hide the editor rather than save from a stale window.
    const userId = currentUser.value?.id;
    const refreshed = userId
      ? await $dropFetch(`/api/v1/user/${userId}/showcase`).catch(() => null)
      : null;
    if (refreshed) applyStoredShowcase(refreshed.items as ShowcaseItem[]);
    else showcaseLoadFailed.value = true;
    showcaseSaveMessage.value = t("account.showcase.saved");
    setTimeout(() => {
      showcaseSaveMessage.value = "";
    }, 3000);
  } catch (e) {
    const err = e as {
      statusMessage?: string;
      data?: { statusMessage?: string };
      message?: string;
    };
    showcaseSaveError.value = t("account.showcase.saveFailed", {
      reason:
        err?.data?.statusMessage ??
        err?.statusMessage ??
        err?.message ??
        String(e),
    });
  } finally {
    showcaseSaving.value = false;
  }
}
</script>
