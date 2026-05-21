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

    <!-- ── Tab bar ─────────────────────────────────────────────────── -->
    <div class="flex gap-1 border-b border-zinc-800">
      <button
        v-for="tab in tabs"
        :key="tab.id"
        class="px-4 py-2 text-sm font-medium transition-colors -mb-px border-b-2"
        :class="
          activeTab === tab.id
            ? 'border-blue-500 text-zinc-100'
            : 'border-transparent text-zinc-500 hover:text-zinc-300'
        "
        @click="activeTab = tab.id"
      >
        {{ tab.label }}
      </button>
    </div>

    <!-- ── Per-game tabs (Goldberg / RetroAchievements) share a game picker ── -->
    <template v-if="activeTab !== 'bulk'">
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
    </template>

    <!-- ── Goldberg tab ─────────────────────────────────────────────── -->
    <template v-if="activeTab === 'goldberg' && selectedGameId">
      <div class="bg-zinc-800/50 rounded-xl p-6 ring-1 ring-white/5 space-y-4">
        <div class="flex items-center justify-between">
          <h2 class="text-lg font-semibold text-zinc-100">Goldberg</h2>
          <button
            class="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium rounded-md transition-colors disabled:opacity-50"
            :disabled="scanning"
            @click="scanProvider('goldberg')"
          >
            {{ scanning ? $t("common.srLoading") : "Scan Goldberg" }}
          </button>
        </div>
        <p class="text-sm text-zinc-400">
          Reads
          <code class="text-zinc-300">steam_settings/achievements.json</code>
          from the game's files, falling back to the Steam Web API, then writes
          the definitions to the DB.
        </p>

        <div v-if="goldbergLink" class="bg-zinc-900/50 p-3 rounded-lg">
          <span class="text-sm font-medium text-zinc-100">Linked</span>
          <span class="text-sm text-zinc-400 ml-2"
            >AppID: {{ goldbergLink.externalGameId }}</span
          >
          <button
            class="ml-3 text-xs text-red-400 hover:text-red-300"
            @click="removeLink('Goldberg')"
          >
            {{ $t("admin.achievements.removeLink") }}
          </button>
        </div>
        <p v-else class="text-sm text-zinc-500">
          No Goldberg link yet — run a scan or add one manually below.
        </p>

        <div class="flex items-end gap-3 pt-3 border-t border-zinc-700/50">
          <div class="flex-1">
            <label class="block text-xs text-zinc-400 mb-1">Steam AppID</label>
            <input
              v-model="goldbergAppIdInput"
              type="text"
              placeholder="e.g. 220"
              class="w-full rounded-md bg-zinc-900 border-zinc-700 text-zinc-100 text-sm px-3 py-2 placeholder-zinc-600"
            />
          </div>
          <button
            class="px-4 py-2 bg-green-600 hover:bg-green-500 text-white text-sm font-medium rounded-md transition-colors shrink-0 disabled:opacity-50"
            :disabled="!goldbergAppIdInput"
            @click="addLink('Goldberg', goldbergAppIdInput)"
          >
            {{ $t("admin.achievements.addLink") }}
          </button>
        </div>
      </div>

      <AchievementListPanel
        :achievements="goldbergAchievements"
        provider-label="Goldberg"
        @reset="resetAchievements"
      />
    </template>

    <!-- ── RetroAchievements tab ────────────────────────────────────── -->
    <template v-if="activeTab === 'retroachievements' && selectedGameId">
      <div class="bg-zinc-800/50 rounded-xl p-6 ring-1 ring-white/5 space-y-4">
        <div class="flex items-center justify-between">
          <h2 class="text-lg font-semibold text-zinc-100">RetroAchievements</h2>
          <button
            v-if="raLink"
            class="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium rounded-md transition-colors disabled:opacity-50"
            :disabled="scanning"
            @click="scanProvider('retroachievements')"
          >
            {{ scanning ? $t("common.srLoading") : "Rescan RA" }}
          </button>
        </div>

        <div v-if="raLink" class="bg-zinc-900/50 p-3 rounded-lg">
          <span class="text-sm font-medium text-zinc-100">Linked</span>
          <span class="text-sm text-zinc-400 ml-2"
            >RA game ID: {{ raLink.externalGameId }}</span
          >
          <button
            class="ml-3 text-xs text-red-400 hover:text-red-300"
            @click="removeLink('RetroAchievements')"
          >
            {{ $t("admin.achievements.removeLink") }}
          </button>
        </div>

        <!-- RA search-and-link (only when not yet linked) -->
        <div v-else class="space-y-3">
          <div class="flex items-center justify-between">
            <h3 class="text-sm font-medium text-zinc-300">
              Find this game on RetroAchievements
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
            <ArrowPathIcon class="size-4 animate-spin" />
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
                class="px-3 py-1.5 bg-green-600 hover:bg-green-500 text-white text-xs font-medium rounded-md transition-colors shrink-0 disabled:opacity-50"
                :disabled="linkingRA"
                @click="linkAndScanRA(result.id)"
              >
                {{ linkingRA ? "Linking..." : "Link & Scan" }}
              </button>
            </div>
          </div>

          <!-- Manual RA game ID entry -->
          <div class="flex items-end gap-3 pt-3 border-t border-zinc-700/50">
            <div class="flex-1">
              <label class="block text-xs text-zinc-400 mb-1">RA game ID</label>
              <input
                v-model="raGameIdInput"
                type="number"
                placeholder="e.g. 1"
                class="w-full rounded-md bg-zinc-900 border-zinc-700 text-zinc-100 text-sm px-3 py-2 placeholder-zinc-600"
              />
            </div>
            <button
              class="px-4 py-2 bg-green-600 hover:bg-green-500 text-white text-sm font-medium rounded-md transition-colors shrink-0 disabled:opacity-50"
              :disabled="!raGameIdInput"
              @click="linkAndScanRA(Number(raGameIdInput))"
            >
              Link & Scan
            </button>
          </div>
        </div>
      </div>

      <AchievementListPanel
        :achievements="raAchievements"
        provider-label="RetroAchievements"
        @reset="resetAchievements"
      />
    </template>

    <!-- ── Bulk tab ─────────────────────────────────────────────────── -->
    <template v-if="activeTab === 'bulk'">
      <div class="bg-zinc-800/50 rounded-xl p-6 ring-1 ring-white/5 space-y-4">
        <h2 class="text-lg font-semibold text-zinc-100">Library-wide scans</h2>
        <p class="text-sm text-zinc-400">
          Runs the achievement maintenance tasks across every game. Progress
          shows in the
          <NuxtLink to="/admin/task" class="text-blue-400 hover:underline"
            >Tasks</NuxtLink
          >
          panel.
        </p>

        <div class="grid gap-3 sm:grid-cols-2">
          <button
            v-for="job in bulkJobs"
            :key="job.taskGroup"
            class="flex flex-col items-start gap-1 rounded-lg bg-zinc-900/50 p-4 text-left hover:bg-zinc-900 transition-colors disabled:opacity-50"
            :disabled="bulkRunning === job.taskGroup"
            @click="runBulkTask(job.taskGroup)"
          >
            <span class="text-sm font-medium text-zinc-100">{{
              job.label
            }}</span>
            <span class="text-xs text-zinc-500">{{ job.description }}</span>
            <span
              v-if="bulkRunning === job.taskGroup"
              class="text-xs text-blue-400 mt-1"
              >Started — see Tasks panel</span
            >
          </button>
        </div>

        <div
          v-if="bulkMessage"
          class="text-sm text-green-400 border-t border-zinc-700/50 pt-3"
        >
          {{ bulkMessage }}
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ArrowPathIcon } from "@heroicons/vue/24/outline";

definePageMeta({ layout: "admin" });

const { t } = useI18n();
useHead({ title: t("admin.achievements.title") });

type TabId = "goldberg" | "retroachievements" | "bulk";
const tabs: { id: TabId; label: string }[] = [
  { id: "goldberg", label: "Goldberg" },
  { id: "retroachievements", label: "RetroAchievements" },
  { id: "bulk", label: "Bulk" },
];
const activeTab = ref<TabId>("goldberg");

type GameData = { id: string; mName: string };
type GameExternalLinkData = {
  id: string;
  provider: string;
  externalGameId: string;
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

// Load games + linked-game IDs for the picker.
const games = (await $dropFetch("/api/v1/admin/game").catch(
  () => [],
)) as GameData[];
const linkedGameIds = (await $dropFetch(
  "/api/v1/admin/achievements/ra-linked-games",
).catch(() => [])) as string[];

// ── Per-game picker state ──────────────────────────────────────────────
const selectedGameId = ref("");
const gameSearchInput = ref("");
const showGameDropdown = ref(false);
const highlightedGameIndex = ref(0);
const showOnlyUnlinked = ref(false);

const links = ref<GameExternalLinkData[]>([]);
const achievements = ref<AchievementData[]>([]);
const scanning = ref(false);

// Goldberg / RA per-tab inputs
const goldbergAppIdInput = ref("");
const raGameIdInput = ref("");
const raSearchResults = ref<RASearchResult[]>([]);
const raSearching = ref(false);
const linkingRA = ref(false);

const filteredGames = computed(() => {
  let filtered = games;
  if (gameSearchInput.value.trim()) {
    const query = gameSearchInput.value.toLowerCase();
    filtered = filtered.filter((g) => g.mName.toLowerCase().includes(query));
  }
  if (showOnlyUnlinked.value) {
    filtered = filtered.filter((g) => !linkedGameIds.includes(g.id));
  }
  return filtered;
});

const selectedGame = computed(() =>
  games.find((g) => g.id === selectedGameId.value),
);

const goldbergLink = computed(() =>
  links.value.find((l) => l.provider === "Goldberg"),
);
const raLink = computed(() =>
  links.value.find((l) => l.provider === "RetroAchievements"),
);
const goldbergAchievements = computed(() =>
  achievements.value.filter((a) => a.provider === "Goldberg"),
);
const raAchievements = computed(() =>
  achievements.value.filter((a) => a.provider === "RetroAchievements"),
);

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

function selectGame(game: GameData) {
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
  raSearchResults.value = [];
}

async function addLink(provider: string, externalGameId: string) {
  if (!selectedGameId.value || !externalGameId) return;
  await $dropFetch(`/api/v1/admin/game/${selectedGameId.value}/external-link`, {
    method: "POST",
    body: { provider, externalGameId },
  });
  goldbergAppIdInput.value = "";
  await refreshData(selectedGameId.value);
}

async function removeLink(provider: string) {
  if (!selectedGameId.value) return;
  if (!confirm(t("admin.achievements.removeLinkConfirm"))) return;
  try {
    await $dropFetch(
      `/api/v1/admin/game/${selectedGameId.value}/external-link`,
      { method: "DELETE", body: { provider } },
    );
    await refreshData(selectedGameId.value);
  } catch (err: unknown) {
    alert(errMessage(err));
  }
}

/** Scan one provider for the selected game via the consolidated endpoint. */
async function scanProvider(provider: "goldberg" | "retroachievements") {
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
    alert(`${t("admin.achievements.scanFailed")}\n\n${errMessage(err)}`);
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
    raSearchResults.value = (await $dropFetch(
      `/api/v1/admin/retroachievements/search?q=${encodeURIComponent(selectedGame.value.mName)}`,
    ).catch(() => [])) as RASearchResult[];
  } finally {
    raSearching.value = false;
  }
}

async function linkAndScanRA(raGameId: number) {
  if (!selectedGameId.value || !raGameId) return;
  linkingRA.value = true;
  try {
    await $dropFetch(
      `/api/v1/admin/game/${selectedGameId.value}/link-retroachievements`,
      { method: "POST", body: { raGameId } },
    );
    const updated = await $dropFetch(
      "/api/v1/admin/achievements/ra-linked-games",
    ).catch(() => []);
    linkedGameIds.splice(0, linkedGameIds.length, ...updated);
    await refreshData(selectedGameId.value);
    raSearchResults.value = [];
    raGameIdInput.value = "";
  } catch (err: unknown) {
    alert(`Failed to link: ${errMessage(err)}`);
  } finally {
    linkingRA.value = false;
  }
}

// ── Bulk tab ───────────────────────────────────────────────────────────
const bulkJobs: { taskGroup: string; label: string; description: string }[] = [
  {
    taskGroup: "scan:goldberg-readiness",
    label: "Scan Goldberg readiness",
    description:
      "Verify steam_settings/ + DB rows for every Steam/Goldberg game.",
  },
  {
    taskGroup: "refresh:achievement-defs",
    label: "Refresh achievement definitions",
    description: "Re-pull Steam achievement titles, descriptions and icons.",
  },
  {
    taskGroup: "link:retroachievements",
    label: "Auto-link RetroAchievements",
    description: "Search RA by name for every unlinked game and link matches.",
  },
  {
    taskGroup: "recalculate:achievements",
    label: "Recalculate achievements",
    description: "Audit per-game / per-user unlock counts.",
  },
];
const bulkRunning = ref<string | null>(null);
const bulkMessage = ref("");

async function runBulkTask(taskGroup: string) {
  bulkRunning.value = taskGroup;
  bulkMessage.value = "";
  try {
    await $dropFetch("/api/v1/admin/task", {
      method: "POST",
      body: { taskGroup },
    });
    bulkMessage.value = `Started "${taskGroup}". Watch progress in the Tasks panel.`;
  } catch (err: unknown) {
    bulkMessage.value = "";
    alert(`Failed to start task: ${errMessage(err)}`);
  } finally {
    bulkRunning.value = null;
  }
}

function errMessage(err: unknown): string {
  return err && typeof err === "object" && "statusMessage" in err
    ? String((err as { statusMessage: string }).statusMessage)
    : String(err);
}
</script>
