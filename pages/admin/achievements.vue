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

    <!-- Game selector -->
    <div class="max-w-md">
      <label class="block text-sm font-medium text-zinc-300 mb-1">{{
        $t("admin.achievements.selectGame")
      }}</label>
      <select
        v-model="selectedGameId"
        class="w-full rounded-md bg-zinc-800 border-zinc-700 text-zinc-100 text-sm px-3 py-2 focus:ring-blue-500 focus:border-blue-500"
      >
        <option value="">{{ $t("admin.achievements.chooseGame") }}</option>
        <option v-for="g in games" :key="g.id" :value="g.id">
          {{ g.mName }}
        </option>
      </select>
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
            </div>
          </div>
        </div>
        <p v-else class="text-sm text-zinc-500">
          {{ $t("admin.achievements.noLinks") }}
        </p>

        <!-- Add link form -->
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
import { TrophyIcon } from "@heroicons/vue/24/solid";

definePageMeta({ layout: "admin" });

const achIconErrors = reactive<Record<string, boolean>>({});

const { t } = useI18n();
useHead({ title: t("admin.achievements.title") });

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

// Load all games for the selector (uses admin endpoint — no pagination cap)
const games = (await $dropFetch("/api/v1/admin/game").catch(() => [])) as {
  id: string;
  mName: string;
}[];

const selectedGameId = ref("");
const links = ref<GameExternalLinkData[]>([]);
const achievements = ref<AchievementData[]>([]);
const scanning = ref(false);
const newLinkProvider = ref("Goldberg");
const newLinkExternalId = ref("");

// Watch game selection
watch(selectedGameId, async (gameId) => {
  if (!gameId) {
    links.value = [];
    achievements.value = [];
    return;
  }
  await refreshData(gameId);
});

async function refreshData(gameId: string) {
  const [linksData, achData] = await Promise.all([
    $dropFetch(`/api/v1/admin/game/${gameId}/external-links`).catch(() => []),
    $dropFetch(`/api/v1/games/${gameId}/achievements`).catch(() => []),
  ]);
  links.value = linksData as GameExternalLinkData[];
  achievements.value = achData as AchievementData[];
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
  } catch {
    alert(t("admin.achievements.scanFailed"));
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
</script>
