<template>
  <div class="max-w-4xl mx-auto">
    <div class="flex items-center justify-between mb-6">
      <div>
        <h1 class="text-2xl font-bold font-display text-zinc-100">
          {{ $t("account.achievements.title") }}
        </h1>
        <p class="text-sm text-zinc-400 mt-1">
          {{
            $t("account.achievements.subtitle", {
              count: allAchievements.length,
            })
          }}
        </p>
      </div>
      <button
        class="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-md transition-colors"
        :disabled="syncing"
        @click="syncAchievements"
      >
        {{ syncing ? $t("common.srLoading") : $t("account.achievements.sync") }}
      </button>
    </div>

    <!-- Connected Accounts -->
    <div
      class="flex items-center justify-between rounded-lg bg-zinc-800/50 ring-1 ring-white/5 p-4 mb-6"
    >
      <div class="flex items-center gap-3">
        <div
          class="size-10 rounded-lg bg-yellow-600/20 flex items-center justify-center"
        >
          <TrophyIcon class="size-5 text-yellow-500" />
        </div>
        <div>
          <p class="text-sm font-medium text-zinc-100">RetroAchievements</p>
          <p v-if="raAccount" class="text-xs text-green-400">
            Connected as {{ raAccount.externalId }}
          </p>
          <p v-else class="text-xs text-zinc-500">Not connected</p>
        </div>
      </div>
      <div class="flex items-center gap-2">
        <button
          v-if="raAccount"
          class="px-3 py-1.5 text-sm text-red-400 hover:text-red-300 transition-colors"
          :disabled="raUnlinking"
          @click="unlinkRA"
        >
          {{ raUnlinking ? "Unlinking..." : "Unlink" }}
        </button>
        <button
          v-else
          class="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded-md transition-colors"
          @click="raDialogOpen = true"
        >
          Connect
        </button>
      </div>
    </div>

    <!-- RA Link Dialog -->
    <TransitionRoot as="template" :show="raDialogOpen">
      <Dialog as="div" class="relative z-50" @close="raDialogOpen = false">
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
                class="w-full max-w-md transform rounded-xl bg-zinc-900 p-6 text-left shadow-xl transition-all ring-1 ring-white/10"
              >
                <DialogTitle
                  class="text-lg font-bold font-display text-zinc-100 mb-2"
                >
                  Connect RetroAchievements
                </DialogTitle>
                <p class="text-sm text-zinc-400 mb-4">
                  Enter your RetroAchievements username and API key. You can
                  find your API key in your
                  <a
                    href="https://retroachievements.org/controlpanel.php"
                    target="_blank"
                    class="text-blue-400 hover:underline"
                    >RA account settings</a
                  >
                  under "Keys".
                </p>

                <div class="space-y-3">
                  <div>
                    <label class="block text-sm font-medium text-zinc-300 mb-1">
                      Username
                    </label>
                    <input
                      v-model="raUsername"
                      type="text"
                      placeholder="YourRAUsername"
                      class="w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/50"
                    />
                  </div>
                  <div>
                    <label class="block text-sm font-medium text-zinc-300 mb-1">
                      API Key
                    </label>
                    <input
                      v-model="raApiKey"
                      type="password"
                      placeholder="Your Web API Key"
                      class="w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/50"
                    />
                  </div>
                </div>

                <div v-if="raLinkError" class="mt-3 text-sm text-red-400">
                  {{ raLinkError }}
                </div>

                <div class="flex justify-end gap-2 mt-6">
                  <button
                    class="px-4 py-2 rounded-md text-sm text-zinc-300 hover:text-zinc-100 transition-colors"
                    @click="raDialogOpen = false"
                  >
                    Cancel
                  </button>
                  <LoadingButton
                    :loading="raLinking"
                    :disabled="!raUsername || !raApiKey"
                    class="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-md text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    @click="linkRA"
                  >
                    Connect
                  </LoadingButton>
                </div>
              </DialogPanel>
            </TransitionChild>
          </div>
        </div>
      </Dialog>
    </TransitionRoot>

    <!-- Filter by game -->
    <div class="mb-6">
      <select
        v-model="selectedGameId"
        class="w-full sm:w-64 rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/50"
      >
        <option value="">
          {{ $t("account.achievements.allGames") }}
        </option>
        <option v-for="g in gamesWithAchievements" :key="g.id" :value="g.id">
          {{ g.mName }}
        </option>
      </select>
    </div>

    <!-- Sort toggle -->
    <div class="flex gap-2 mb-4">
      <button
        v-for="s in sortOptions"
        :key="s.value"
        :class="[
          'px-3 py-1.5 rounded-md text-xs font-medium transition-colors',
          sortBy === s.value
            ? 'bg-zinc-700 text-zinc-100'
            : 'bg-zinc-800/50 text-zinc-500 hover:text-zinc-300',
        ]"
        @click="sortBy = s.value"
      >
        {{ s.label }}
      </button>
    </div>

    <!-- Achievements grid -->
    <div v-if="filteredAchievements.length === 0" class="py-12 text-center">
      <TrophyIcon class="size-12 text-zinc-700 mx-auto mb-3" />
      <p class="text-zinc-500">{{ $t("account.achievements.empty") }}</p>
    </div>
    <div v-else class="space-y-2">
      <div
        v-for="item in filteredAchievements"
        :key="item.id"
        class="flex items-center gap-3 p-3 rounded-lg bg-zinc-800/50 hover:bg-zinc-700/50 transition-colors"
      >
        <img
          v-if="achievementIcon(item) && !achievementIconErrors[item.id]"
          :src="achievementIcon(item)"
          class="size-10 rounded shrink-0"
          @error="achievementIconErrors[item.id] = true"
        />
        <div
          v-else
          class="size-10 rounded shrink-0 bg-zinc-700/50 flex items-center justify-center"
        >
          <TrophyIcon class="size-5 text-zinc-500" />
        </div>
        <div class="flex-1 min-w-0">
          <p class="text-sm font-medium text-zinc-100 truncate">
            {{ item.achievement?.title }}
          </p>
          <p class="text-xs text-zinc-400 truncate">
            {{ item.achievement?.description }}
          </p>
        </div>
        <NuxtLink
          v-if="item.game"
          :to="`/store/${item.game.id}`"
          class="flex items-center gap-2 shrink-0"
        >
          <img
            v-if="item.game.mIconObjectId"
            :src="useObject(item.game.mIconObjectId)"
            class="size-6 rounded"
          />
          <span
            class="text-xs text-zinc-400 hover:text-blue-400 transition-colors"
          >
            {{ item.game.mName }}
          </span>
        </NuxtLink>
        <span class="text-xs text-zinc-600 shrink-0">
          {{ formatDate(item.unlockedAt) }}
        </span>
      </div>
    </div>

    <!-- Achievement Reset -->
    <div class="border-t border-zinc-800 mt-10 pt-8">
      <h2 class="text-lg font-semibold font-display text-zinc-100 mb-1">
        {{ $t("account.achievements.resetTitle") }}
      </h2>
      <p class="text-sm text-zinc-400 mb-4">
        {{ $t("account.achievements.resetDescription") }}
      </p>
      <div class="flex items-center gap-3">
        <select
          v-model="resetGameId"
          class="flex-1 sm:flex-initial sm:w-64 rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/50"
        >
          <option value="">{{ $t("account.achievements.allGames") }}</option>
          <option v-for="g in gamesWithAchievements" :key="g.id" :value="g.id">
            {{ g.mName }}
          </option>
        </select>
        <button
          :disabled="resetting"
          class="rounded-md bg-red-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-red-500 disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
          @click="resetAchievements"
        >
          {{
            resetting
              ? $t("common.srLoading")
              : $t("account.achievements.resetButton")
          }}
        </button>
      </div>
      <p v-if="resetMessage" class="mt-3 text-sm text-green-400">
        {{ resetMessage }}
      </p>
    </div>

    <!-- Achievement Diagnostics -->
    <div class="border-t border-zinc-800 mt-10 pt-8">
      <h2 class="text-lg font-semibold font-display text-zinc-100 mb-1">
        {{ $t("account.achievements.diagnosticsTitle") }}
      </h2>
      <p class="text-sm text-zinc-400 mb-4">
        {{ $t("account.achievements.diagnosticsDescription") }}
      </p>
      <div class="flex items-center gap-3">
        <select
          v-model="debugGameId"
          class="flex-1 sm:flex-initial sm:w-64 rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/50"
        >
          <option value="" disabled>
            {{ $t("account.achievements.selectGame") }}
          </option>
          <option v-for="g in allGames" :key="g.id" :value="g.id">
            {{ g.mName }}
          </option>
        </select>
        <button
          :disabled="debugLoading || !debugGameId"
          class="rounded-md bg-zinc-700 px-4 py-2 text-sm font-semibold text-zinc-100 shadow-sm hover:bg-zinc-600 disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
          @click="runDiagnostic"
        >
          {{
            debugLoading
              ? $t("common.srLoading")
              : $t("account.achievements.runDiagnostic")
          }}
        </button>
      </div>

      <div
        v-if="debugResult"
        class="mt-4 rounded-lg border border-zinc-800 bg-zinc-900/50 p-4 text-xs font-mono"
      >
        <div class="flex items-center gap-2 mb-3">
          <span
            class="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium"
            :class="
              debugResult.status === 'OK'
                ? 'bg-green-600/20 text-green-400'
                : 'bg-red-600/20 text-red-400'
            "
          >
            {{ debugResult.status }}
          </span>
          <span class="text-zinc-400">{{ debugResult.game.name }}</span>
        </div>

        <div v-if="debugResult.issues.length > 0" class="mb-3 space-y-1">
          <p
            v-for="(issue, i) in debugResult.issues"
            :key="i"
            class="text-red-400 leading-relaxed"
          >
            {{ issue }}
          </p>
        </div>

        <div class="grid grid-cols-2 gap-x-6 gap-y-1 text-zinc-400 max-w-md">
          <span>Total achievements:</span>
          <span class="text-zinc-200">{{
            debugResult.summary.totalAchievements
          }}</span>
          <span>Goldberg achievements:</span>
          <span class="text-zinc-200">{{
            debugResult.summary.goldbergAchievements
          }}</span>
          <span>Unlocked by you:</span>
          <span class="text-zinc-200">{{
            debugResult.summary.unlockedByUser
          }}</span>
          <span>Goldberg AppIDs:</span>
          <span class="text-zinc-200">{{
            debugResult.summary.goldbergAppIds.join(", ") || "NONE"
          }}</span>
          <span>External links:</span>
          <span class="text-zinc-200">{{
            debugResult.summary.externalLinks.join(", ") || "NONE"
          }}</span>
          <span>Orphan sessions:</span>
          <span
            :class="
              debugResult.summary.orphanSessions > 0
                ? 'text-red-400'
                : 'text-zinc-200'
            "
          >
            {{ debugResult.summary.orphanSessions }}
          </span>
          <span>Connected clients:</span>
          <span class="text-zinc-200">{{
            debugResult.summary.connectedClients
          }}</span>
        </div>

        <details class="mt-3">
          <summary class="cursor-pointer text-zinc-500 hover:text-zinc-300">
            Show all {{ debugResult.details.achievements.length }} achievements
          </summary>
          <div class="mt-2 max-h-60 overflow-y-auto space-y-0.5">
            <div
              v-for="a in debugResult.details.achievements"
              :key="a.id"
              class="flex items-center gap-2 py-0.5"
              :class="a.unlocked ? 'text-green-400' : 'text-zinc-500'"
            >
              <span>{{ a.unlocked ? "✓" : "✗" }}</span>
              <span class="truncate">{{ a.title }}</span>
              <span class="ml-auto text-zinc-600"
                >{{ a.provider }}:{{ a.externalId }}</span
              >
            </div>
          </div>
        </details>

        <div v-if="debugResult.details.activeSessions.length > 0" class="mt-3">
          <p class="text-zinc-500 mb-1">Orphaned sessions:</p>
          <div
            v-for="s in debugResult.details.activeSessions"
            :key="s.id"
            class="text-red-400"
          >
            {{ s.id.slice(0, 8) }}... — started {{ s.ageMinutes }}m ago
          </div>
        </div>
      </div>

      <p v-if="debugError" class="mt-3 text-sm text-red-400">
        {{ debugError }}
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { TrophyIcon } from "@heroicons/vue/24/solid";
import {
  Dialog,
  DialogPanel,
  DialogTitle,
  TransitionChild,
  TransitionRoot,
} from "@headlessui/vue";
import { useObject } from "~/composables/objects";

// Achievement icon error tracking — show trophy fallback when URL fails or is empty
const achievementIconErrors = reactive<Record<string, boolean>>({});
const achievementIcon = (item: AchievementItem) => {
  const url = item.achievement?.iconUrl;
  return url && url.trim() !== "" ? url : undefined;
};

const { t } = useI18n();
useHead({ title: t("account.achievements.title") });

type AchievementItem = {
  id: string;
  unlockedAt: string;
  achievement?: {
    id: string;
    title: string;
    description: string;
    iconUrl: string;
    gameId: string;
  };
  game?: {
    id: string;
    mName: string;
    mIconObjectId?: string;
    mCoverObjectId?: string;
  };
};

const allAchievements = ref<AchievementItem[]>([]);
const selectedGameId = ref("");
const sortBy = ref<"newest" | "oldest" | "game">("newest");
const syncing = ref(false);

// ── Connected Accounts (RetroAchievements) ────────────────────────────────

type ExternalAccount = {
  id: string;
  provider: string;
  externalId: string;
};

const raAccount = ref<ExternalAccount | null>(null);
const raDialogOpen = ref(false);
const raUsername = ref("");
const raApiKey = ref("");
const raLinking = ref(false);
const raUnlinking = ref(false);
const raLinkError = ref("");

// Fetch existing external accounts
try {
  const { accounts } = (await $dropFetch("/api/v1/user/external-accounts")) as {
    accounts: ExternalAccount[];
  };
  raAccount.value =
    accounts?.find((a) => a.provider === "RetroAchievements") ?? null;
} catch {
  // ignore – user may not have any linked accounts
}

async function linkRA() {
  if (!raUsername.value || !raApiKey.value) return;
  raLinking.value = true;
  raLinkError.value = "";
  try {
    const account = (await $dropFetch(
      "/api/v1/user/external-accounts/retroachievements",
      {
        method: "PUT",
        body: {
          username: raUsername.value,
          apiKey: raApiKey.value,
        },
      },
    )) as ExternalAccount;
    raAccount.value = account;
    raDialogOpen.value = false;
    raUsername.value = "";
    raApiKey.value = "";
  } catch (err: unknown) {
    const msg =
      err && typeof err === "object" && "statusMessage" in err
        ? String((err as { statusMessage: string }).statusMessage)
        : "Failed to link account";
    raLinkError.value = msg;
  } finally {
    raLinking.value = false;
  }
}

async function unlinkRA() {
  raUnlinking.value = true;
  try {
    await $dropFetch("/api/v1/user/external-accounts/retroachievements", {
      method: "DELETE",
    });
    raAccount.value = null;
  } finally {
    raUnlinking.value = false;
  }
}

// Reset state
const resetGameId = ref("");
const resetting = ref(false);
const resetMessage = ref("");

// Diagnostics state
const debugGameId = ref("");
const debugLoading = ref(false);
const debugError = ref("");
const debugResult = ref<{
  game: { id: string; name: string };
  status: string;
  issues: string[];
  summary: {
    totalAchievements: number;
    goldbergAchievements: number;
    unlockedByUser: number;
    goldbergAppIds: string[];
    externalLinks: string[];
    orphanSessions: number;
    connectedClients: number;
  };
  details: {
    achievements: {
      id: string;
      externalId: string;
      provider: string;
      title: string;
      hasIcon: boolean;
      unlocked: boolean;
      unlockedAt: string | null;
    }[];
    activeSessions: {
      id: string;
      startedAt: string;
      ageMinutes: number;
    }[];
    clients: {
      id: string;
      name: string;
      lastConnected: string;
    }[];
  };
} | null>(null);

// All games list (for diagnostics — not limited to games with unlocked achievements)
const allGames = ref<{ id: string; mName: string }[]>([]);
const storeData = (await $dropFetch(
  "/api/v1/store?sort=name&order=asc&limit=200",
).catch(() => ({ results: [] }))) as {
  results: { id: string; mName: string }[];
};
allGames.value = (storeData.results ?? []).map((g) => ({
  id: g.id,
  mName: g.mName,
}));

const sortOptions = computed(
  (): { value: "newest" | "oldest" | "game"; label: string }[] => [
    { value: "newest", label: t("account.achievements.sortNewest") },
    { value: "oldest", label: t("account.achievements.sortOldest") },
    { value: "game", label: t("account.achievements.sortGame") },
  ],
);

// Load achievements
const data = (await $dropFetch("/api/v1/user/achievements/list").catch(
  () => [],
)) as AchievementItem[];
allAchievements.value = data;

// Distinct games that have achievements
const gamesWithAchievements = computed(() => {
  const seen = new Map<string, { id: string; mName: string }>();
  for (const item of allAchievements.value) {
    if (item.game && !seen.has(item.game.id)) {
      seen.set(item.game.id, { id: item.game.id, mName: item.game.mName });
    }
  }
  return [...seen.values()].sort((a, b) => a.mName.localeCompare(b.mName));
});

const filteredAchievements = computed(() => {
  let items = allAchievements.value;

  if (selectedGameId.value) {
    items = items.filter((a) => a.game?.id === selectedGameId.value);
  }

  if (sortBy.value === "newest") {
    items = [...items].sort(
      (a, b) =>
        new Date(b.unlockedAt).getTime() - new Date(a.unlockedAt).getTime(),
    );
  } else if (sortBy.value === "oldest") {
    items = [...items].sort(
      (a, b) =>
        new Date(a.unlockedAt).getTime() - new Date(b.unlockedAt).getTime(),
    );
  } else if (sortBy.value === "game") {
    items = [...items].sort((a, b) =>
      (a.game?.mName ?? "").localeCompare(b.game?.mName ?? ""),
    );
  }

  return items;
});

async function syncAchievements() {
  syncing.value = true;
  try {
    await $dropFetch("/api/v1/user/achievements/sync", { method: "POST" });
    const refreshed = (await $dropFetch("/api/v1/user/achievements/list").catch(
      () => [],
    )) as AchievementItem[];
    allAchievements.value = refreshed;
  } finally {
    syncing.value = false;
  }
}

const formatDate = (d: string) => new Date(d).toLocaleDateString();

// ── Achievement Reset ─────────────────────────────────────────────────────

async function resetAchievements() {
  const msg = resetGameId.value
    ? t("account.achievements.confirmGame")
    : t("account.achievements.confirmAll");

  if (!confirm(msg)) return;

  resetting.value = true;
  resetMessage.value = "";

  try {
    const query = resetGameId.value ? `?gameId=${resetGameId.value}` : "";
    const res = (await $dropFetch(`/api/v1/user/achievements/reset${query}`, {
      method: "DELETE",
    })) as { deleted: number };

    resetMessage.value = `${t("account.achievements.resetSuccess")} (${res.deleted})`;

    // Refresh achievement list
    const refreshed = (await $dropFetch("/api/v1/user/achievements/list").catch(
      () => [],
    )) as AchievementItem[];
    allAchievements.value = refreshed;

    setTimeout(() => {
      resetMessage.value = "";
    }, 5000);
  } catch {
    resetMessage.value = "";
  } finally {
    resetting.value = false;
  }
}

// ── Achievement Diagnostics ───────────────────────────────────────────────

async function runDiagnostic() {
  if (!debugGameId.value) return;
  debugLoading.value = true;
  debugResult.value = null;
  debugError.value = "";

  try {
    const res = (await $dropFetch(
      `/api/v1/user/achievements/debug/${debugGameId.value}`,
    )) as typeof debugResult.value;
    debugResult.value = res;
  } catch (e) {
    debugError.value = `Diagnostic failed: ${e}`;
  } finally {
    debugLoading.value = false;
  }
}
</script>
