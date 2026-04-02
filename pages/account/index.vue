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
                  :src="slot.data.iconUrl"
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
              <span class="text-xs">{{ $t("account.showcase.addSlot") }}</span>
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
        <span v-if="showcaseSaveMessage" class="text-sm text-green-400">
          {{ showcaseSaveMessage }}
        </span>
      </div>
    </section>

    <!-- Achievements section -->
    <section>
      <h2 class="text-xl font-bold font-display text-zinc-100 mb-1">
        {{ $t("account.achievements.title") }}
      </h2>
      <p class="text-sm text-zinc-400 mb-6">
        {{ $t("account.achievements.resetDescription") }}
      </p>

      <div class="space-y-3">
        <!-- Per-game reset -->
        <div class="flex items-center gap-3">
          <select
            v-model="resetGameId"
            class="flex-1 rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/50"
          >
            <option value="">
              {{ $t("account.achievements.allGames") }}
            </option>
            <option
              v-for="game in allGames?.results ?? []"
              :key="game.id"
              :value="game.id"
            >
              {{ game.mName }}
            </option>
          </select>
          <LoadingButton
            :loading="achievementResetting"
            class="px-4 py-2 bg-red-600 hover:bg-red-500 text-white rounded-md text-sm font-medium transition-colors whitespace-nowrap"
            @click="resetAchievements"
          >
            {{ $t("account.achievements.resetButton") }}
          </LoadingButton>
        </div>
        <span v-if="achievementResetMessage" class="text-sm text-green-400">
          {{ achievementResetMessage }}
        </span>
      </div>
    </section>

    <!-- Cloud Saves section -->
    <section>
      <h2 class="text-xl font-bold font-display text-zinc-100 mb-1">
        Cloud Saves
      </h2>
      <p class="text-sm text-zinc-400 mb-6">
        Manage your cloud save data. Download backups or delete saves you no
        longer need.
      </p>

      <div
        v-if="!cloudSaves || cloudSaves.length === 0"
        class="text-sm text-zinc-500"
      >
        No cloud saves found.
      </div>

      <div v-else class="space-y-4">
        <div
          v-for="(group, gIdx) in cloudSaveGroups"
          :key="gIdx"
          class="rounded-lg border border-zinc-800 bg-zinc-900/50"
        >
          <!-- Game header -->
          <div
            class="flex items-center gap-3 border-b border-zinc-800 px-4 py-3"
          >
            <img
              v-if="group.iconObjectId"
              :src="useObject(group.iconObjectId)"
              class="size-6 rounded"
            />
            <span class="text-sm font-medium text-zinc-100">
              {{ group.gameName }}
            </span>
            <span class="text-xs text-zinc-500">
              {{ group.saves.length }}
              {{ group.saves.length === 1 ? "slot" : "slots" }}
            </span>
          </div>

          <!-- Save slots -->
          <div class="divide-y divide-zinc-800/50">
            <div
              v-for="save in group.saves"
              :key="save.index"
              class="flex items-center justify-between px-4 py-2.5"
            >
              <div class="flex-1">
                <span class="text-sm text-zinc-200"
                  >Slot {{ save.index + 1 }}</span
                >
                <span class="ml-3 text-xs text-zinc-500">
                  {{ new Date(save.createdAt).toLocaleDateString() }}
                </span>
                <span
                  v-if="save.historyObjectIds?.length > 0"
                  class="ml-3 text-xs text-zinc-500"
                >
                  {{ save.historyObjectIds.length }}
                  {{
                    save.historyObjectIds.length === 1 ? "version" : "versions"
                  }}
                </span>
              </div>
              <div class="flex items-center gap-2">
                <a
                  v-if="save.historyObjectIds?.length > 0"
                  :href="`/api/v1/object/${save.historyObjectIds[save.historyObjectIds.length - 1]}`"
                  download
                  class="rounded px-2.5 py-1 text-xs font-medium text-zinc-300 bg-zinc-800 hover:bg-zinc-700 transition-colors"
                >
                  Download
                </a>
                <button
                  @click="
                    deleteCloudSave(group.gameId, save.index, group.gameName)
                  "
                  :disabled="cloudSaveDeleting"
                  class="rounded px-2.5 py-1 text-xs font-medium text-red-400 bg-zinc-800 hover:bg-red-600/20 disabled:opacity-50 transition-colors"
                >
                  Delete
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <span v-if="cloudSaveMessage" class="mt-3 block text-sm text-green-400">
        {{ cloudSaveMessage }}
      </span>
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

// ── Achievement reset ──────────────────────────────────────────────────────
const resetGameId = ref("");
const achievementResetting = ref(false);
const achievementResetMessage = ref("");

async function resetAchievements() {
  const confirmed = window.confirm(
    resetGameId.value
      ? t("account.achievements.confirmGame")
      : t("account.achievements.confirmAll"),
  );
  if (!confirmed) return;
  achievementResetting.value = true;
  achievementResetMessage.value = "";
  try {
    const query: Record<string, string> = {};
    if (resetGameId.value) query.gameId = resetGameId.value;
    const result = await $dropFetch<{ deleted: number }>(
      "/api/v1/user/achievements/reset",
      { method: "DELETE", query },
    );
    achievementResetMessage.value = t("account.achievements.resetSuccess", {
      count: result?.deleted ?? 0,
    });
    setTimeout(() => {
      achievementResetMessage.value = "";
    }, 5000);
  } finally {
    achievementResetting.value = false;
  }
}

// ── Cloud Saves ───────────────────────────────────────────────────────────

type CloudSaveSlot = {
  gameId: string;
  index: number;
  createdAt: string;
  playtime: number;
  historyObjectIds: string[];
  historyChecksums: string[];
  game?: { id: string; mName: string; mIconObjectId: string };
};

const cloudSaves = ref<CloudSaveSlot[]>([]);
const cloudSaveDeleting = ref(false);
const cloudSaveMessage = ref("");

// Fetch saves on mount
onMounted(async () => {
  try {
    const data = await $dropFetch<CloudSaveSlot[]>("/api/v1/user/saves");
    cloudSaves.value = data ?? [];
  } catch {
    // Non-critical
  }
});

const cloudSaveGroups = computed(() => {
  const groups = new Map<
    string,
    {
      gameId: string;
      gameName: string;
      iconObjectId: string;
      saves: CloudSaveSlot[];
    }
  >();
  for (const save of cloudSaves.value) {
    const gameId = save.gameId;
    if (!groups.has(gameId)) {
      groups.set(gameId, {
        gameId,
        gameName: save.game?.mName ?? "Unknown Game",
        iconObjectId: save.game?.mIconObjectId ?? "",
        saves: [],
      });
    }
    groups.get(gameId)!.saves.push(save);
  }
  for (const group of groups.values()) {
    group.saves.sort((a, b) => a.index - b.index);
  }
  return Array.from(groups.values()).sort((a, b) =>
    a.gameName.localeCompare(b.gameName),
  );
});

async function deleteCloudSave(
  gameId: string,
  slotIndex: number,
  gameName: string,
) {
  if (
    !confirm(
      `Delete cloud save slot ${slotIndex + 1} for ${gameName}? This cannot be undone.`,
    )
  )
    return;

  cloudSaveDeleting.value = true;
  cloudSaveMessage.value = "";

  try {
    await $dropFetch(`/api/v1/user/saves/${gameId}/${slotIndex}`, {
      method: "DELETE",
    });
    cloudSaves.value = cloudSaves.value.filter(
      (s) => !(s.gameId === gameId && s.index === slotIndex),
    );
    cloudSaveMessage.value = `Deleted slot ${slotIndex + 1} for ${gameName}.`;
    setTimeout(() => {
      cloudSaveMessage.value = "";
    }, 5000);
  } catch {
    cloudSaveMessage.value = "Failed to delete save.";
  } finally {
    cloudSaveDeleting.value = false;
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

// ── Showcase ────────────────────────────────────────────────────────────────

const MAX_SLOTS = 6;

const showcaseTypeLabels = computed<Record<string, string>>(() => ({
  Achievement: t("user.showcase.types.Achievement"),
  Custom: t("user.showcase.types.Custom"),
  FavoriteGame: t("user.showcase.types.FavoriteGame"),
}));
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
  data: any;
  game?: {
    id: string;
    mName: string;
    mIconObjectId: string;
    mCoverObjectId: string;
  } | null;
};

// Split current showcase into game and achievement items
const existingGameItems = (currentShowcase?.items ?? []).filter(
  (i: any) => i.type === "FavoriteGame",
);
const existingAchItems = (currentShowcase?.items ?? []).filter(
  (i: any) => i.type === "Achievement",
);

const gameSlots = ref<(ShowcaseItem | null)[]>(
  Array.from({ length: MAX_SLOTS }, (_, i) =>
    existingGameItems[i] ? { ...existingGameItems[i] } : null,
  ),
);

const ACHIEVEMENT_SLOTS = 6;
const achievementSlots = ref<(ShowcaseItem | null)[]>(
  Array.from({ length: ACHIEVEMENT_SLOTS }, (_, i) =>
    existingAchItems[i] ? { ...existingAchItems[i] } : null,
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

// Achievement picker
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

function openGameAddDialog(idx: number) {
  addSlotIndex.value = idx;
  addType.value = "FavoriteGame";
  addGameId.value = null;
  addItemId.value = null;
  gameSearch.value = "";
  gameAchievements.value = [];
  addDialogOpen.value = true;
}

function openAchievementAddDialog(idx: number) {
  addSlotIndex.value = idx;
  addType.value = "Achievement";
  addGameId.value = null;
  addItemId.value = null;
  gameSearch.value = "";
  gameAchievements.value = [];
  addDialogOpen.value = true;
}

const canAdd = computed(() => {
  if (addType.value === "Achievement") {
    return !!addGameId.value && !!addItemId.value;
  }
  return !!addGameId.value;
});

function confirmAdd() {
  if (!canAdd.value) return;
  const game = allGames?.results?.find((g) => g.id === addGameId.value) ?? null;
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

async function saveShowcase() {
  showcaseSaving.value = true;
  showcaseSaveMessage.value = "";
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
    await $dropFetch("/api/v1/user/showcase", {
      method: "PUT",
      body: { items: [...gameItems, ...achItems] },
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
