<template>
  <div class="space-y-6">
    <div>
      <h1 class="text-2xl font-semibold text-zinc-100">
        {{ $t("admin.achievements.title") }}
      </h1>
      <p class="mt-1 text-sm text-zinc-400">
        {{ $t("admin.achievements.subtitle") }}
      </p>
    </div>

    <!-- Bulk Auto-Link Button -->
    <div class="flex gap-3">
      <button
        class="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-md transition-colors flex items-center gap-2"
        :disabled="bulkScanning"
        @click="bulkAutoLink"
      >
        <SparklesIcon v-if="!bulkScanning" class="size-4" />
        <svg
          v-else
          class="size-4 animate-spin"
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
        >
          <circle
            class="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            stroke-width="4"
          />
          <path
            class="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
          />
        </svg>
        {{ bulkScanning ? "Auto-Linking..." : "Auto-Link All Unlinked Games" }}
      </button>
      <div
        v-if="bulkScanResult"
        class="flex items-center gap-2 px-3 py-2 bg-green-900/30 rounded-md"
      >
        <CheckIcon class="size-4 text-green-400" />
        <span class="text-sm text-green-300">{{ bulkScanResult }}</span>
      </div>
    </div>

    <!-- Game selector with search and filter -->
    <div class="space-y-3 max-w-md">
      <div class="flex items-center justify-between">
        <label class="block text-sm font-medium text-zinc-300">{{
          $t("admin.achievements.selectGame")
        }}</label>
        <label
          class="flex items-center gap-2 text-sm text-zinc-400 hover:text-zinc-300 cursor-pointer"
        >
          <input v-model="showOnlyUnlinked" type="checkbox" class="rounded" />
          <span>Show only unlinked</span>
        </label>
      </div>

      <!-- Searchable Combobox -->
      <div class="relative">
        <input
          v-model="gameSearchInput"
          type="text"
          :placeholder="$t('admin.achievements.chooseGame')"
          class="w-full rounded-md bg-zinc-800 border border-zinc-700 text-zinc-100 text-sm px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors"
          @focus="showGameDropdown = true"
          @keydown.escape="showGameDropdown = false"
          @keydown.arrow-down="
            highlightedGameIndex = Math.min(
              highlightedGameIndex + 1,
              filteredGames.length - 1,
            )
          "
          @keydown.arrow-up="
            highlightedGameIndex = Math.max(highlightedGameIndex - 1, 0)
          "
          @keydown.enter="selectGame(filteredGames[highlightedGameIndex])"
        />

        <!-- Dropdown with filtered games -->
        <div
          v-if="showGameDropdown && filteredGames.length > 0"
          class="absolute top-full left-0 right-0 mt-1 bg-zinc-800 border border-zinc-700 rounded-md shadow-lg z-10 max-h-96 overflow-y-auto"
        >
          <div
            v-for="(game, idx) in filteredGames"
            :key="game.id"
            class="px-3 py-2 cursor-pointer transition-colors"
            :class="
              idx === highlightedGameIndex
                ? 'bg-blue-600/50 text-zinc-100'
                : 'hover:bg-zinc-700/50 text-zinc-200'
            "
            @click="selectGame(game)"
            @mouseenter="highlightedGameIndex = idx"
          >
            {{ game.mName }}
          </div>
        </div>
      </div>

      <!-- Selected game display -->
      <div
        v-if="selectedGameId"
        class="flex items-center justify-between px-3 py-2 bg-blue-900/30 rounded-md"
      >
        <span class="text-sm text-blue-200">{{ selectedGame?.mName }}</span>
        <button
          class="text-xs text-blue-400 hover:text-blue-300"
          @click="clearGameSelection"
        >
          Clear
        </button>
      </div>
    </div>

    <template v-if="selectedGameId">
      <!-- External Links Section -->
      <div class="bg-zinc-800/50 rounded-xl p-6 ring-1 ring-white/5 space-y-4">
        <h2 class="text-lg font-semibold text-zinc-100">
          {{ $t("admin.achievements.externalLinks") }}
        </h2>

        <!-- Existing links -->
        <div v-if="links.length > 0" class="space-y-2">
          <div
            v-for="link in links"
            :key="link.id"
            class="flex items-center justify-between bg-zinc-900/50 p-3 rounded-lg"
          >
            <div>
              <span class="text-sm font-medium text-zinc-100">{{
                link.provider
              }}</span>
              <span class="text-sm text-zinc-400 ml-2"
                >ID: {{ link.externalGameId }}</span
              >
              <span
                v-if="link.achievementCount"
                class="ml-3 text-xs text-blue-400"
              >
                {{
                  $t("admin.achievements.achievementCount", {
                    count: link.achievementCount,
                  })
                }}
              </span>
            </div>
            <div class="flex gap-2">
              <button
                class="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium rounded-md transition-colors"
                :disabled="scanning"
                @click="scanProvider(link.provider)"
              >
                {{
                  scanning
                    ? $t("common.srLoading")
                    : $t("admin.achievements.scan")
                }}
              </button>
              <button
                class="px-3 py-1.5 bg-red-600/80 hover:bg-red-500 text-white text-xs font-medium rounded-md transition-colors"
                :disabled="scanning"
                @click="removeLink(link.provider)"
              >
                {{ $t("admin.achievements.removeLink") }}
              </button>
            </div>
          </div>
        </div>
        <p v-else class="text-sm text-zinc-500">
          {{ $t("admin.achievements.noLinks") }}
        </p>

        <!-- RA Auto-Search Suggestions -->
        <div
          v-if="selectedGame && !hasRALink"
          class="pt-3 border-t border-zinc-700/50 space-y-3"
        >
          <div class="flex items-center justify-between">
            <h3 class="text-sm font-medium text-zinc-300">
              RetroAchievements Matches
            </h3>
            <button
              v-if="raSearchResults.length === 0 && !raSearching"
              class="text-xs text-blue-400 hover:text-blue-300"
              @click="searchRAMatches"
            >
              Search
            </button>
          </div>

          <div
            v-if="raSearching"
            class="flex items-center gap-2 text-sm text-zinc-400"
          >
            <svg
              class="size-4 animate-spin"
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
            >
              <circle
                class="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                stroke-width="4"
              />
              <path
                class="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
              />
            </svg>
            Searching RetroAchievements...
          </div>

          <div v-if="raSearchResults.length > 0" class="space-y-2">
            <div
              v-for="result in raSearchResults"
              :key="result.id"
              class="flex items-center justify-between bg-zinc-900/50 p-3 rounded-lg"
            >
              <div class="flex-1">
                <p class="text-sm font-medium text-zinc-100">
                  {{ result.title }}
                </p>
                <p class="text-xs text-zinc-500">{{ result.consoleName }}</p>
                <p class="text-xs text-blue-400 mt-1">
                  {{ result.achievementCount }} achievements
                </p>
              </div>
              <button
                class="px-3 py-1.5 bg-green-600 hover:bg-green-500 text-white text-xs font-medium rounded-md transition-colors shrink-0"
                :disabled="linkingRA"
                @click="linkAndScanRA(result.id)"
              >
                {{ linkingRA ? "Linking..." : "Link & Scan" }}
              </button>
            </div>
          </div>
        </div>

        <!-- Manual Add link form -->
        <div class="flex items-end gap-3 pt-3 border-t border-zinc-700/50">
          <div class="flex-1">
            <label class="block text-xs text-zinc-400 mb-1">{{
              $t("admin.achievements.provider")
            }}</label>
            <select
              v-model="newLinkProvider"
              class="w-full rounded-md bg-zinc-900 border-zinc-700 text-zinc-100 text-sm px-3 py-2"
            >
              <option value="Goldberg">Goldberg</option>
              <option value="RetroAchievements">RetroAchievements</option>
            </select>
          </div>
          <div class="flex-1">
            <label class="block text-xs text-zinc-400 mb-1">{{
              $t("admin.achievements.externalId")
            }}</label>
            <input
              v-model="newLinkExternalId"
              type="text"
              :placeholder="'Game ID'"
              class="w-full rounded-md bg-zinc-900 border-zinc-700 text-zinc-100 text-sm px-3 py-2 placeholder-zinc-600"
            />
          </div>
          <button
            class="px-4 py-2 bg-green-600 hover:bg-green-500 text-white text-sm font-medium rounded-md transition-colors shrink-0"
            :disabled="!newLinkExternalId"
            @click="addLink"
          >
            {{ $t("admin.achievements.addLink") }}
          </button>
        </div>
      </div>

      <!-- Achievements List -->
      <div class="bg-zinc-800/50 rounded-xl p-6 ring-1 ring-white/5 space-y-4">
        <div class="flex items-center justify-between">
          <h2 class="text-lg font-semibold text-zinc-100">
            {{
              $t("admin.achievements.achievementsList", {
                count: achievements.length,
              })
            }}
          </h2>
          <button
            v-if="achievements.length > 0"
            class="px-3 py-1.5 bg-red-600/80 hover:bg-red-500 text-white text-xs font-medium rounded-md transition-colors"
            @click="resetAchievements"
          >
            {{ $t("admin.achievements.resetAll") }}
          </button>
        </div>

        <div
          v-if="achievements.length > 0"
          class="space-y-1 max-h-96 overflow-y-auto"
        >
          <div
            v-for="ach in achievements"
            :key="ach.id"
            class="flex items-center gap-3 p-2 rounded-lg hover:bg-zinc-900/50 transition-colors"
          >
            <img
              v-if="
                ach.iconUrl &&
                ach.iconUrl.trim() !== '' &&
                !achIconErrors[ach.id]
              "
              :src="ach.iconUrl"
              class="size-8 rounded"
              @error="achIconErrors[ach.id] = true"
            />
            <div
              v-else
              class="size-8 rounded bg-zinc-700/50 flex items-center justify-center"
            >
              <TrophyIcon class="size-4 text-zinc-500" />
            </div>
            <div class="flex-1 min-w-0">
              <p class="text-sm text-zinc-100 truncate">{{ ach.title }}</p>
              <p class="text-xs text-zinc-500 truncate">
                {{ ach.description }}
              </p>
            </div>
            <span class="text-xs text-zinc-600">{{ ach.provider }}</span>
          </div>
        </div>
        <p v-else class="text-sm text-zinc-500">
          {{ $t("admin.achievements.noAchievements") }}
        </p>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { TrophyIcon, SparklesIcon, CheckIcon } from "@heroicons/vue/24/solid";

definePageMeta({ layout: "admin" });

const achIconErrors = reactive<Record<string, boolean>>({});

const { t } = useI18n();
useHead({ title: t("admin.achievements.title") });

type GameData = {
  id: string;
  mName: string;
};

type GameExternalLinkData = {
  id: string;
  provider: string;
  externalGameId: string;
  achievementCount?: number;
};

type AchievementData = {
  id: string;
  title: string;
  description: string;
  iconUrl: string;
  iconLockedUrl: string;
  provider: string;
  externalId: string;
  displayOrder: number;
};

type RASearchResult = {
  id: number;
  title: string;
  consoleName: string;
  achievementCount: number;
};

// Load all games for the selector
const games = (await $dropFetch("/api/v1/admin/game").catch(
  () => [],
)) as GameData[];

// Load games that have RA links
const raLinkedGameIds = (await $dropFetch(
  "/api/v1/admin/achievements/ra-linked-games",
).catch(() => [])) as string[];

// State
const selectedGameId = ref("");
const gameSearchInput = ref("");
const showGameDropdown = ref(false);
const highlightedGameIndex = ref(0);
const showOnlyUnlinked = ref(false);

const links = ref<GameExternalLinkData[]>([]);
const achievements = ref<AchievementData[]>([]);
const scanning = ref(false);
const newLinkProvider = ref("Goldberg");
const newLinkExternalId = ref("");

const raSearchResults = ref<RASearchResult[]>([]);
const raSearching = ref(false);
const linkingRA = ref(false);

const bulkScanning = ref(false);
const bulkScanResult = ref("");

// Computed
const filteredGames = computed(() => {
  let filtered = games;

  // Filter by search input
  if (gameSearchInput.value.trim()) {
    const query = gameSearchInput.value.toLowerCase();
    filtered = filtered.filter((g) => g.mName.toLowerCase().includes(query));
  }

  // Filter by unlinked status
  if (showOnlyUnlinked.value) {
    filtered = filtered.filter((g) => !raLinkedGameIds.includes(g.id));
  }

  return filtered.slice(0, 20); // Max 20 visible
});

const selectedGame = computed(() =>
  games.find((g) => g.id === selectedGameId.value),
);

const hasRALink = computed(() =>
  links.value.some((l) => l.provider === "RetroAchievements"),
);

// Watch game selection
watch(selectedGameId, async (gameId) => {
  if (!gameId) {
    links.value = [];
    achievements.value = [];
    raSearchResults.value = [];
    gameSearchInput.value = "";
    return;
  }
  showGameDropdown.value = false;
  gameSearchInput.value = selectedGame.value?.mName || "";
  await refreshData(gameId);
});

async function selectGame(game: GameData) {
  selectedGameId.value = game.id;
}

function clearGameSelection() {
  selectedGameId.value = "";
  gameSearchInput.value = "";
}

async function refreshData(gameId: string) {
  const [linksData, achData] = await Promise.all([
    $dropFetch(`/api/v1/admin/game/${gameId}/external-links`).catch(() => []),
    $dropFetch(`/api/v1/games/${gameId}/achievements`).catch(() => []),
  ]);
  links.value = linksData as GameExternalLinkData[];
  achievements.value = achData as AchievementData[];
  raSearchResults.value = []; // Clear search results when game changes
}

async function addLink() {
  if (!selectedGameId.value || !newLinkExternalId.value) return;
  await $dropFetch(`/api/v1/admin/game/${selectedGameId.value}/external-link`, {
    method: "POST",
    body: {
      provider: newLinkProvider.value,
      externalGameId: newLinkExternalId.value,
    },
  });
  newLinkExternalId.value = "";
  await refreshData(selectedGameId.value);
}

async function removeLink(provider: string) {
  if (!selectedGameId.value) return;
  if (!confirm(t("admin.achievements.removeLinkConfirm"))) return;
  try {
    await $dropFetch(
      `/api/v1/admin/game/${selectedGameId.value}/external-link`,
      {
        method: "DELETE",
        body: { provider },
      },
    );
    await refreshData(selectedGameId.value);
  } catch (err: unknown) {
    const msg =
      err && typeof err === "object" && "statusMessage" in err
        ? String((err as { statusMessage: string }).statusMessage)
        : String(err);
    alert(msg);
  }
}

async function scanProvider(provider: string) {
  if (!selectedGameId.value) return;
  scanning.value = true;
  try {
    await $dropFetch("/api/v1/admin/achievements/scan", {
      method: "POST",
      body: { gameId: selectedGameId.value, provider },
    });
    await refreshData(selectedGameId.value);
    alert(t("admin.achievements.scanComplete"));
  } catch (err: unknown) {
    const msg =
      err && typeof err === "object" && "statusMessage" in err
        ? String((err as { statusMessage: string }).statusMessage)
        : String(err);
    alert(`${t("admin.achievements.scanFailed")}\n\n${msg}`);
  } finally {
    scanning.value = false;
  }
}

async function resetAchievements() {
  if (!selectedGameId.value) return;
  if (!confirm(t("admin.achievements.resetConfirm"))) return;
  await $dropFetch(
    `/api/v1/admin/game/${selectedGameId.value}/achievements-reset`,
    { method: "POST" },
  );
  await refreshData(selectedGameId.value);
}

async function searchRAMatches() {
  if (!selectedGame.value) return;
  raSearching.value = true;
  try {
    const results = (await $dropFetch(
      `/api/v1/admin/retroachievements/search?q=${encodeURIComponent(selectedGame.value.mName)}`,
    ).catch(() => [])) as RASearchResult[];
    raSearchResults.value = results;
  } finally {
    raSearching.value = false;
  }
}

async function linkAndScanRA(raGameId: number) {
  if (!selectedGameId.value) return;
  linkingRA.value = true;
  try {
    await $dropFetch(
      `/api/v1/admin/game/${selectedGameId.value}/link-retroachievements`,
      {
        method: "POST",
        body: { raGameId },
      },
    );
    // Refresh the RA linked games list
    const updated = await $dropFetch(
      "/api/v1/admin/achievements/ra-linked-games",
    ).catch(() => []);
    raLinkedGameIds.splice(0, raLinkedGameIds.length, ...updated);
    await refreshData(selectedGameId.value);
    raSearchResults.value = [];
  } catch (err: unknown) {
    const msg =
      err && typeof err === "object" && "statusMessage" in err
        ? String((err as { statusMessage: string }).statusMessage)
        : String(err);
    alert(`Failed to link: ${msg}`);
  } finally {
    linkingRA.value = false;
  }
}

async function bulkAutoLink() {
  bulkScanning.value = true;
  bulkScanResult.value = "";
  try {
    const result = (await $dropFetch(
      "/api/v1/admin/achievements/scan-retroachievements",
      { method: "POST" },
    )) as { matched: number; totalAchievements: number };

    // Refresh the RA linked games list
    const updated = await $dropFetch(
      "/api/v1/admin/achievements/ra-linked-games",
    ).catch(() => []);
    raLinkedGameIds.splice(0, raLinkedGameIds.length, ...updated);

    // Refresh current game data if one is selected
    if (selectedGameId.value) {
      await refreshData(selectedGameId.value);
    }

    bulkScanResult.value = `Matched ${result.matched} games, found ${result.totalAchievements} achievements`;
    setTimeout(() => {
      bulkScanResult.value = "";
    }, 5000);
  } catch (err: unknown) {
    const msg =
      err && typeof err === "object" && "statusMessage" in err
        ? String((err as { statusMessage: string }).statusMessage)
        : String(err);
    alert(`Bulk auto-link failed: ${msg}`);
  } finally {
    bulkScanning.value = false;
  }
}
</script>
