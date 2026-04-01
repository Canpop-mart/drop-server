<template>
  <div class="max-w-4xl mx-auto px-4 py-8">
    <!-- Header -->
    <div class="flex items-center justify-between mb-6">
      <div>
        <h1 class="text-3xl font-bold font-display text-zinc-100">
          {{ $t("requests.title") }}
        </h1>
        <p class="text-zinc-400 text-sm mt-1">{{ $t("requests.subtitle") }}</p>
      </div>
      <button
        v-if="user"
        class="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-md text-sm font-medium transition-colors"
        @click="createDialogOpen = true"
      >
        <PlusIcon class="size-4" />
        {{ $t("requests.createNew") }}
      </button>
    </div>

    <!-- Sort toggle -->
    <div class="flex gap-2 mb-6">
      <button
        v-for="s in sorts"
        :key="s.value"
        :class="[
          'px-3 py-1.5 rounded-md text-sm font-medium transition-colors',
          sort === s.value
            ? 'bg-blue-600 text-white'
            : 'bg-zinc-800 text-zinc-400 hover:text-zinc-100',
        ]"
        @click="sort = s.value"
      >
        {{ s.label }}
      </button>
    </div>

    <!-- Requests list -->
    <div v-if="loading" class="text-zinc-500 py-12 text-center">
      {{ $t("common.srLoading") }}
    </div>
    <div v-else-if="sortedRequests.length === 0" class="py-12 text-center">
      <p class="text-zinc-500">{{ $t("requests.empty") }}</p>
    </div>
    <div v-else class="space-y-3">
      <div
        v-for="req in sortedRequests"
        :key="req.id"
        class="flex gap-4 p-4 rounded-xl bg-zinc-900 ring-1 ring-white/5 hover:ring-blue-500/20 transition-all"
      >
        <!-- Vote column -->
        <div class="flex flex-col items-center gap-1 shrink-0 w-12">
          <button
            :class="[
              'p-1.5 rounded-md transition-colors',
              req.votes.userVote === 'Up'
                ? 'text-blue-400 bg-blue-500/10'
                : 'text-zinc-500 hover:text-zinc-300',
            ]"
            :disabled="!user"
            @click="vote(req, 'Up')"
          >
            <ChevronUpIcon class="size-5" />
          </button>
          <span
            class="text-sm font-bold"
            :class="req.votes.up > 0 ? 'text-blue-400' : 'text-zinc-500'"
            >{{ req.votes.up }}</span
          >
          <button
            :class="[
              'p-1.5 rounded-md transition-colors',
              req.votes.userVote === 'Down'
                ? 'text-red-400 bg-red-500/10'
                : 'text-zinc-500 hover:text-zinc-300',
            ]"
            :disabled="!user"
            @click="vote(req, 'Down')"
          >
            <ChevronDownIcon class="size-5" />
          </button>
        </div>

        <!-- Content -->
        <div class="flex-1 min-w-0">
          <div class="flex items-start gap-3">
            <div class="flex-1 min-w-0">
              <h3 class="font-semibold text-zinc-100 truncate">
                {{ req.title }}
              </h3>
              <p
                v-if="req.description"
                class="text-sm text-zinc-400 mt-1 line-clamp-2"
              >
                {{ req.description }}
              </p>
            </div>
            <!-- Status badge -->
            <span
              :class="[
                'shrink-0 inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
                req.status === 'Pending'
                  ? 'bg-yellow-500/10 text-yellow-400 ring-1 ring-yellow-500/20'
                  : 'bg-green-500/10 text-green-400 ring-1 ring-green-500/20',
              ]"
            >
              {{ requestStatusLabels[req.status] }}
            </span>
          </div>

          <div class="flex items-center gap-4 mt-3">
            <!-- Requester -->
            <div class="flex items-center gap-1.5">
              <img
                v-if="req.requester?.profilePictureObjectId"
                :src="useObject(req.requester.profilePictureObjectId)"
                class="size-5 rounded-full"
              />
              <span class="text-xs text-zinc-500">
                {{
                  req.requester?.displayName ||
                  req.requester?.username ||
                  $t("user.unknown")
                }}
              </span>
            </div>
            <!-- Timestamp -->
            <RelativeTime :date="req.createdAt" class="text-xs text-zinc-600" />
            <!-- External links -->
            <a
              v-if="req.steamUrl"
              :href="req.steamUrl"
              target="_blank"
              rel="noopener"
              class="text-xs text-zinc-500 hover:text-blue-400 transition-colors"
            >
              Steam
            </a>
            <a
              v-if="req.igdbUrl"
              :href="req.igdbUrl"
              target="_blank"
              rel="noopener"
              class="text-xs text-zinc-500 hover:text-blue-400 transition-colors"
            >
              IGDB
            </a>
            <!-- Withdraw (own pending requests) -->
            <button
              v-if="req.requester?.id === user?.id && req.status === 'Pending'"
              class="text-xs text-zinc-600 hover:text-red-400 transition-colors ml-auto"
              @click="withdraw(req)"
            >
              {{ $t("requests.withdraw") }}
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Create dialog -->
    <TransitionRoot as="template" :show="createDialogOpen">
      <Dialog as="div" class="relative z-50" @close="createDialogOpen = false">
        <TransitionChild
          as="template"
          enter="ease-out duration-200"
          enter-from="opacity-0"
          enter-to="opacity-100"
          leave="ease-in duration-150"
          leave-from="opacity-100"
          leave-to="opacity-0"
        >
          <div class="fixed inset-0 bg-zinc-950/80 backdrop-blur-sm" />
        </TransitionChild>
        <div class="fixed inset-0 z-10 overflow-y-auto">
          <div class="flex min-h-full items-center justify-center p-4">
            <TransitionChild
              as="template"
              enter="ease-out duration-200"
              enter-from="opacity-0 scale-95"
              enter-to="opacity-100 scale-100"
              leave="ease-in duration-150"
              leave-from="opacity-100 scale-100"
              leave-to="opacity-0 scale-95"
            >
              <DialogPanel
                class="w-full max-w-md rounded-xl bg-zinc-900 p-6 shadow-xl ring-1 ring-white/10"
              >
                <DialogTitle
                  class="text-lg font-bold font-display text-zinc-100 mb-4"
                >
                  {{ $t("requests.createTitle") }}
                </DialogTitle>

                <div class="space-y-4">
                  <div>
                    <label class="block text-sm font-medium text-zinc-300 mb-1"
                      >{{ $t("requests.form.title") }}
                      <span class="text-red-400">*</span></label
                    >
                    <input
                      v-model="newTitle"
                      type="text"
                      maxlength="120"
                      class="w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/50"
                      :placeholder="$t('requests.form.titlePlaceholder')"
                    />
                  </div>
                  <div>
                    <label
                      class="block text-sm font-medium text-zinc-300 mb-1"
                      >{{ $t("requests.form.description") }}</label
                    >
                    <textarea
                      v-model="newDescription"
                      maxlength="500"
                      rows="3"
                      class="w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/50 resize-none"
                      :placeholder="$t('requests.form.descriptionPlaceholder')"
                    />
                  </div>
                  <div>
                    <label
                      class="block text-sm font-medium text-zinc-300 mb-1"
                      >{{ $t("requests.form.steamUrl") }}</label
                    >
                    <input
                      v-model="newSteamUrl"
                      type="url"
                      class="w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/50"
                      placeholder="https://store.steampowered.com/app/..."
                    />
                  </div>
                </div>

                <div class="flex justify-end gap-2 mt-6">
                  <button
                    class="px-4 py-2 rounded-md text-sm text-zinc-300 hover:text-zinc-100"
                    @click="createDialogOpen = false"
                  >
                    {{ $t("cancel") }}
                  </button>
                  <LoadingButton
                    :loading="creating"
                    :disabled="!newTitle.trim()"
                    class="px-4 py-2 rounded-md text-sm font-medium bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-50 disabled:cursor-not-allowed"
                    @click="createRequest"
                  >
                    {{ $t("requests.form.submit") }}
                  </LoadingButton>
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
import {
  PlusIcon,
  ChevronUpIcon,
  ChevronDownIcon,
} from "@heroicons/vue/24/outline";
import {
  Dialog,
  DialogPanel,
  DialogTitle,
  TransitionChild,
  TransitionRoot,
} from "@headlessui/vue";
import { useObject } from "~/composables/objects";
import { useUser } from "~/composables/user";

const { t } = useI18n();
useHead({ title: t("requests.title") });

const requestStatusLabels = computed<Record<string, string>>(() => ({
  Approved: t("requests.status.Approved"),
  Pending: t("requests.status.Pending"),
  Rejected: t("requests.status.Rejected"),
}));

const user = useUser();

type RequestItem = {
  id: string;
  title: string;
  description: string;
  igdbUrl: string | null;
  steamUrl: string | null;
  status: "Pending" | "Approved";
  createdAt: string;
  requester: {
    id: string;
    username: string;
    displayName: string;
    profilePictureObjectId: string;
  } | null;
  votes: {
    up: number;
    down: number;
    total: number;
    userVote: "Up" | "Down" | null;
  };
};

const sorts = [
  { value: "newest", label: t("requests.sortNewest") },
  { value: "votes", label: t("requests.sortVotes") },
] as const;

const sort = ref<"newest" | "votes">("votes");
const loading = ref(false);
const requests = ref<RequestItem[]>([]);

const sortedRequests = computed(() => {
  const list = [...requests.value];
  if (sort.value === "votes") {
    list.sort((a, b) => b.votes.up - a.votes.up);
  } else {
    list.sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
  }
  return list;
});

async function fetchRequests() {
  loading.value = true;
  try {
    const data = (await $dropFetch("/api/v1/community/requests").catch(
      () => [],
    )) as RequestItem[];
    requests.value = data;
  } finally {
    loading.value = false;
  }
}

await fetchRequests();

// Voting
async function vote(req: RequestItem, v: "Up" | "Down") {
  if (!user.value) return;
  // Toggle off if same vote
  if (req.votes.userVote === v) {
    const result = await $dropFetch(`/api/v1/store/requests/${req.id}/vote`, {
      method: "DELETE",
    }).catch(() => null);
    if (result) {
      req.votes = { ...req.votes, ...(result as object), userVote: null };
    }
    return;
  }
  const result = await $dropFetch(`/api/v1/store/requests/${req.id}/vote`, {
    method: "POST",
    body: { vote: v },
  }).catch(() => null);
  if (result) {
    req.votes = { ...req.votes, ...(result as object) };
  }
}

// Withdraw
async function withdraw(req: RequestItem) {
  await $dropFetch(`/api/v1/store/requests/${req.id}`, {
    method: "DELETE",
  }).catch(() => null);
  requests.value = requests.value.filter((r) => r.id !== req.id);
}

// Create dialog
const createDialogOpen = ref(false);
const creating = ref(false);
const newTitle = ref("");
const newDescription = ref("");
const newSteamUrl = ref("");

async function createRequest() {
  if (!newTitle.value.trim()) return;
  creating.value = true;
  try {
    await $dropFetch("/api/v1/store/requests/create", {
      method: "POST",
      body: {
        title: newTitle.value.trim(),
        description: newDescription.value.trim(),
        steamUrl: newSteamUrl.value.trim() || undefined,
      },
    });
    newTitle.value = "";
    newDescription.value = "";
    newSteamUrl.value = "";
    createDialogOpen.value = false;
    await fetchRequests();
  } finally {
    creating.value = false;
  }
}
</script>
