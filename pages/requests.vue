<template>
  <div class="max-w-6xl mx-auto px-4 py-8">
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
        @click="openCreateDialog"
      >
        <PlusIcon class="size-4" />
        {{ $t("requests.createNew") }}
      </button>
    </div>

    <!-- View tabs: the public board, or the user's own requests -->
    <div class="flex flex-wrap items-center gap-2 mb-6">
      <button
        v-for="v in views"
        :key="v.value"
        :class="[
          'px-3 py-1.5 rounded-md text-sm font-medium transition-colors',
          view === v.value
            ? 'bg-blue-600 text-white'
            : 'bg-zinc-800 text-zinc-400 hover:text-zinc-100',
        ]"
        @click="setView(v.value)"
      >
        {{ v.label }}
      </button>
      <template v-if="view === 'board'">
        <span class="mx-2 h-5 w-px bg-zinc-700" />
        <button
          v-for="s in sorts"
          :key="s.value"
          :class="[
            'px-3 py-1.5 rounded-md text-sm font-medium transition-colors',
            sort === s.value
              ? 'bg-zinc-700 text-zinc-100'
              : 'bg-zinc-800 text-zinc-400 hover:text-zinc-100',
          ]"
          @click="sort = s.value"
        >
          {{ s.label }}
        </button>
      </template>
    </div>

    <!-- ── Board ───────────────────────────────────────────────────── -->
    <template v-if="view === 'board'">
      <div v-if="boardLoading" class="text-zinc-500 py-12 text-center">
        {{ $t("common.srLoading") }}
      </div>
      <div
        v-else-if="boardError"
        class="py-12 flex flex-col items-center gap-3 text-center"
      >
        <p class="text-red-400 text-sm">
          {{ $t("requests.loadFailed", [boardError]) }}
        </p>
        <button
          class="px-3 py-1.5 rounded-md text-sm bg-zinc-800 text-zinc-200 hover:bg-zinc-700"
          @click="fetchBoard"
        >
          {{ $t("requests.retry") }}
        </button>
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
          <!-- Vote column. Votes are only open while a request is pending. -->
          <div class="flex flex-col items-center gap-1 shrink-0 w-12">
            <button
              :class="[
                'p-1.5 rounded-md transition-colors disabled:opacity-40 disabled:cursor-not-allowed',
                req.votes.userVote === 'Up'
                  ? 'text-blue-400 bg-blue-500/10'
                  : 'text-zinc-500 hover:text-zinc-300',
              ]"
              :disabled="!user || req.status !== 'Pending' || voting[req.id]"
              :title="
                req.status !== 'Pending' ? $t('requests.votingClosed') : ''
              "
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
                'p-1.5 rounded-md transition-colors disabled:opacity-40 disabled:cursor-not-allowed',
                req.votes.userVote === 'Down'
                  ? 'text-red-400 bg-red-500/10'
                  : 'text-zinc-500 hover:text-zinc-300',
              ]"
              :disabled="!user || req.status !== 'Pending' || voting[req.id]"
              :title="
                req.status !== 'Pending' ? $t('requests.votingClosed') : ''
              "
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
              <span
                :class="[
                  'shrink-0 inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
                  statusClasses[req.status],
                ]"
              >
                {{
                  req.gameId
                    ? $t("requests.inLibrary")
                    : requestStatusLabels[req.status]
                }}
              </span>
            </div>

            <div class="flex items-center gap-4 mt-3 flex-wrap">
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
              <RelativeTime
                :date="req.createdAt"
                class="text-xs text-zinc-600"
              />
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
              <NuxtLink
                v-if="req.gameId"
                :to="`/store/${req.gameId}`"
                class="text-xs text-blue-400 hover:text-blue-300"
              >
                {{ $t("requests.viewGame") }}
              </NuxtLink>
              <!-- Withdraw (own pending requests) -->
              <button
                v-if="
                  req.requester?.id === user?.id && req.status === 'Pending'
                "
                class="text-xs text-zinc-600 hover:text-red-400 transition-colors ml-auto disabled:opacity-50"
                :disabled="withdrawing[req.id]"
                @click="withdraw(req.id)"
              >
                {{
                  withdrawing[req.id]
                    ? $t("requests.withdrawing")
                    : $t("requests.withdraw")
                }}
              </button>
            </div>
            <p v-if="rowErrors[req.id]" class="mt-2 text-xs text-red-400">
              {{ rowErrors[req.id] }}
            </p>
          </div>
        </div>
      </div>
    </template>

    <!-- ── My requests ─────────────────────────────────────────────── -->
    <template v-else>
      <div v-if="!user" class="py-12 text-center text-zinc-500">
        {{ $t("requests.mine.signedOut") }}
      </div>
      <div v-else-if="mineLoading" class="text-zinc-500 py-12 text-center">
        {{ $t("common.srLoading") }}
      </div>
      <div
        v-else-if="mineError"
        class="py-12 flex flex-col items-center gap-3 text-center"
      >
        <p class="text-red-400 text-sm">
          {{ $t("requests.loadFailed", [mineError]) }}
        </p>
        <button
          class="px-3 py-1.5 rounded-md text-sm bg-zinc-800 text-zinc-200 hover:bg-zinc-700"
          @click="fetchMine"
        >
          {{ $t("requests.retry") }}
        </button>
      </div>
      <div v-else-if="mine.length === 0" class="py-12 text-center">
        <p class="text-zinc-500">{{ $t("requests.mine.empty") }}</p>
      </div>
      <div v-else class="space-y-3">
        <div
          v-for="req in mine"
          :key="req.id"
          class="p-4 rounded-xl bg-zinc-900 ring-1 ring-white/5"
        >
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
            <span
              :class="[
                'shrink-0 inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
                statusClasses[req.status],
              ]"
            >
              {{
                req.game
                  ? $t("requests.inLibrary")
                  : requestStatusLabels[req.status]
              }}
            </span>
          </div>

          <!-- What happened to it -->
          <div
            v-if="req.status === 'Denied'"
            class="mt-3 rounded-md bg-red-500/5 p-3 ring-1 ring-red-500/20"
          >
            <p class="text-sm text-zinc-300">
              {{
                req.denyReason
                  ? $t("requests.mine.deniedWithReason", [req.denyReason])
                  : $t("requests.mine.deniedNoReason")
              }}
            </p>
          </div>
          <p
            v-else-if="req.status === 'Approved' && !req.game"
            class="mt-3 text-sm text-zinc-400"
          >
            {{ $t("requests.mine.approvedWaiting") }}
          </p>

          <div class="flex items-center gap-4 mt-3 flex-wrap">
            <RelativeTime :date="req.createdAt" class="text-xs text-zinc-600" />
            <span class="text-xs text-zinc-500">
              {{ $t("requests.mine.votes", [req.votes.up, req.votes.down]) }}
            </span>
            <NuxtLink
              v-if="req.game"
              :to="`/store/${req.game.id}`"
              class="text-xs text-blue-400 hover:text-blue-300"
            >
              {{ $t("requests.viewGame") }}
            </NuxtLink>
            <button
              v-if="req.status === 'Pending'"
              class="text-xs text-zinc-600 hover:text-red-400 transition-colors ml-auto disabled:opacity-50"
              :disabled="withdrawing[req.id]"
              @click="withdraw(req.id)"
            >
              {{
                withdrawing[req.id]
                  ? $t("requests.withdrawing")
                  : $t("requests.withdraw")
              }}
            </button>
          </div>
          <p v-if="rowErrors[req.id]" class="mt-2 text-xs text-red-400">
            {{ rowErrors[req.id] }}
          </p>
        </div>
      </div>
    </template>

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
                      :maxlength="TITLE_MAX"
                      class="w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/50"
                      :placeholder="$t('requests.form.titlePlaceholder')"
                      @input="conflict = null"
                    />
                  </div>
                  <div>
                    <label
                      class="block text-sm font-medium text-zinc-300 mb-1"
                      >{{ $t("requests.form.description") }}</label
                    >
                    <textarea
                      v-model="newDescription"
                      :maxlength="DESCRIPTION_MAX"
                      rows="3"
                      class="w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/50 resize-none"
                      :placeholder="$t('requests.form.descriptionPlaceholder')"
                    />
                    <p class="text-xs text-zinc-600 text-right">
                      {{ newDescription.length }}/{{ DESCRIPTION_MAX }}
                    </p>
                  </div>
                  <!-- Metadata-provider search. Lets the requester pick the
                       game from the same lookups the admin import flow
                       uses, so the request lands with the provider id (used
                       to spot duplicates and to link the request when the
                       game is imported). The manual Steam URL field below
                       stays as a fallback for obscure titles. -->
                  <div>
                    <label class="block text-sm font-medium text-zinc-300 mb-1">
                      {{ $t("requests.form.findLabel") }}
                      <span class="text-zinc-500 font-normal">{{
                        $t("requests.form.optional")
                      }}</span>
                    </label>

                    <!-- Picked state -->
                    <div
                      v-if="matchedResult"
                      class="flex items-center gap-3 rounded-md border border-blue-500/30 bg-blue-500/5 p-3"
                    >
                      <img
                        v-if="matchedResult.icon"
                        :src="matchedResult.icon"
                        class="size-12 rounded object-cover bg-zinc-800 shrink-0"
                        alt=""
                      />
                      <div class="flex-1 min-w-0">
                        <p class="text-sm font-medium text-zinc-100 truncate">
                          {{ matchedResult.name }}
                        </p>
                        <p class="text-xs text-zinc-400 truncate">
                          {{ matchedResult.sourceName
                          }}<span v-if="matchedResult.year">
                            &middot; {{ matchedResult.year }}</span
                          >
                        </p>
                      </div>
                      <button
                        type="button"
                        class="text-xs text-zinc-400 hover:text-red-400 transition-colors shrink-0"
                        @click="clearMatch"
                      >
                        {{ $t("requests.form.clear") }}
                      </button>
                    </div>

                    <!-- Search state -->
                    <div v-else>
                      <input
                        v-model="searchQuery"
                        type="text"
                        class="w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/50"
                        :placeholder="$t('requests.form.searchPlaceholder')"
                        @input="onSearchInput"
                      />
                      <div v-if="searching" class="mt-2 text-xs text-zinc-500">
                        {{ $t("requests.form.searching") }}
                      </div>
                      <template v-else>
                        <p v-if="searchError" class="mt-2 text-xs text-red-400">
                          {{ $t("requests.form.searchFailed", [searchError]) }}
                        </p>
                        <p
                          v-else-if="failedProviders.length > 0"
                          class="mt-2 text-xs text-yellow-400"
                        >
                          {{
                            $t("requests.form.providersFailed", [
                              failedProviders.join(", "),
                            ])
                          }}
                        </p>
                        <div
                          v-if="searchResults.length > 0"
                          class="mt-2 max-h-56 overflow-y-auto rounded-md border border-zinc-700 bg-zinc-800/50 divide-y divide-zinc-700/50"
                        >
                          <button
                            v-for="r in searchResults"
                            :key="`${r.sourceId}-${r.id}`"
                            type="button"
                            class="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-zinc-700/40 transition-colors"
                            @click="pickResult(r)"
                          >
                            <img
                              v-if="r.icon"
                              :src="r.icon"
                              class="size-10 rounded object-cover bg-zinc-900 shrink-0"
                              alt=""
                            />
                            <div class="flex-1 min-w-0">
                              <p class="text-sm text-zinc-100 truncate">
                                {{ r.name }}
                              </p>
                              <p class="text-xs text-zinc-500 truncate">
                                {{ r.sourceName
                                }}<span v-if="r.year">
                                  &middot; {{ r.year }}</span
                                >
                              </p>
                            </div>
                          </button>
                        </div>
                        <p
                          v-else-if="
                            searchedQuery.length >= 2 &&
                            !searchError &&
                            failedProviders.length === 0
                          "
                          class="mt-2 text-xs text-zinc-500"
                        >
                          {{ $t("requests.form.noMatches") }}
                        </p>
                      </template>
                    </div>
                  </div>

                  <!-- Manual Steam URL fallback, collapsed until needed. -->
                  <details v-if="!matchedResult" class="text-sm">
                    <summary
                      class="cursor-pointer text-xs text-zinc-500 hover:text-zinc-300 select-none"
                    >
                      {{ $t("requests.form.pasteSteam") }}
                    </summary>
                    <input
                      v-model="newSteamUrl"
                      type="url"
                      class="mt-2 w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/50"
                      placeholder="https://store.steampowered.com/app/..."
                      @input="conflict = null"
                    />
                  </details>
                </div>

                <!-- Refused as a duplicate: offer the existing request -->
                <div
                  v-if="conflict"
                  class="mt-4 rounded-md bg-yellow-500/5 p-3 ring-1 ring-yellow-500/20 space-y-2"
                >
                  <template v-if="conflict.reason === 'in-library'">
                    <p class="text-sm text-zinc-200">
                      {{
                        $t("requests.conflict.inLibrary", [
                          conflict.game?.name ?? "",
                        ])
                      }}
                    </p>
                    <NuxtLink
                      v-if="conflict.game"
                      :to="`/store/${conflict.game.id}`"
                      class="inline-block text-sm text-blue-400 hover:text-blue-300"
                      @click="createDialogOpen = false"
                    >
                      {{ $t("requests.viewGame") }}
                    </NuxtLink>
                  </template>
                  <template v-else-if="conflict.request">
                    <p class="text-sm text-zinc-200">
                      {{
                        conflict.request.mine
                          ? $t("requests.conflict.yours")
                          : conflict.reason === "duplicate"
                            ? $t("requests.conflict.duplicate")
                            : $t("requests.conflict.similar")
                      }}
                    </p>
                    <!-- The existing request's title is free text, so show
                         it on its own line, plus the game it was matched to
                         when that says something the title does not. -->
                    <p class="text-sm text-zinc-300">
                      {{ $t("requests.conflict.existingTitle") }}
                      <span class="font-semibold text-zinc-100">{{
                        conflict.request.title
                      }}</span>
                    </p>
                    <p v-if="conflictMatchedName" class="text-sm text-zinc-300">
                      {{ $t("requests.conflict.existingMatch") }}
                      <span class="font-semibold text-zinc-100">{{
                        conflictMatchedName
                      }}</span>
                    </p>
                    <div class="flex gap-2 flex-wrap">
                      <LoadingButton
                        v-if="
                          !conflict.request.mine &&
                          conflict.request.status === 'Pending'
                        "
                        :loading="votingForConflict"
                        class="px-3 py-1.5 rounded-md text-sm font-medium bg-blue-600 hover:bg-blue-500 text-white"
                        @click="voteForConflict"
                      >
                        {{ $t("requests.conflict.voteInstead") }}
                      </LoadingButton>
                      <button
                        v-if="conflict.reason === 'similar'"
                        class="px-3 py-1.5 rounded-md text-sm bg-zinc-800 text-zinc-200 hover:bg-zinc-700"
                        @click="createRequest(true)"
                      >
                        {{ $t("requests.conflict.submitAnyway") }}
                      </button>
                    </div>
                  </template>
                </div>

                <div
                  v-if="createError"
                  class="mt-4 rounded-md bg-red-500/10 p-3 ring-1 ring-red-500/20"
                >
                  <p class="text-sm text-red-400">{{ createError }}</p>
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
                    @click="createRequest(false)"
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
import { useNotifications } from "~/composables/notifications";

const { t } = useI18n();
useHead({ title: t("requests.title") });

// Mirrors the server-side limits in server/internal/requests/index.ts.
const TITLE_MAX = 120;
const DESCRIPTION_MAX = 500;

type Status = "Pending" | "Approved" | "Denied" | "Withdrawn";

const requestStatusLabels = computed<Record<string, string>>(() => ({
  Approved: t("requests.status.Approved"),
  Denied: t("requests.status.Denied"),
  Pending: t("requests.status.Pending"),
  Withdrawn: t("requests.status.Withdrawn"),
}));

const statusClasses: Record<Status, string> = {
  Pending: "bg-yellow-500/10 text-yellow-400 ring-1 ring-yellow-500/20",
  Approved: "bg-green-500/10 text-green-400 ring-1 ring-green-500/20",
  Denied: "bg-red-500/10 text-red-400 ring-1 ring-red-500/20",
  Withdrawn: "bg-zinc-500/10 text-zinc-400 ring-1 ring-zinc-500/20",
};

const user = useUser();
const route = useRoute();
const router = useRouter();

/** Best message available from a $dropFetch failure. */
function errorMessage(e: unknown, fallback: string) {
  const err = e as {
    statusMessage?: string;
    message?: string;
    data?: { statusMessage?: string; message?: string };
  };
  return (
    err?.data?.statusMessage ||
    err?.data?.message ||
    err?.statusMessage ||
    err?.message ||
    fallback
  );
}

// ── View ──────────────────────────────────────────────────────────────
// `?view=mine` is where request notifications point.
type View = "board" | "mine";
const views = [
  { value: "board", label: t("requests.viewBoard") },
  { value: "mine", label: t("requests.viewMine") },
] as const;
const view = ref<View>(route.query.view === "mine" ? "mine" : "board");
function setView(v: View) {
  view.value = v;
  router.replace({
    query: { ...route.query, view: v === "mine" ? "mine" : undefined },
  });
  if (v === "mine") {
    if (!mineLoaded.value) fetchMine();
    void markDecisionsRead();
  }
}
// A notification link to `?view=mine` while this page is already open only
// changes the query, so follow it.
watch(
  () => route.query.view,
  (q) => {
    const next: View = q === "mine" ? "mine" : "board";
    if (next !== view.value) setView(next);
  },
);

// ── Marking decisions read ────────────────────────────────────────────
// My requests is where a requester reads the decisions on their requests,
// so opening it marks the request decision notifications read (the ones
// server/internal/requests sends, nonce `request-<kind>-<id>`). That covers
// the web bell, and the desktop client, which shows this page in an iframe
// and keeps its own unread count: it is told through a message to the
// embedding window (drop-app main/composables/request-notifications.ts)
// and polls again.
const REQUEST_DECISION_NONCE = /^request-(approved|denied|fulfilled)-/;
const REQUEST_DECISIONS_READ_MESSAGE = "drop:request-decisions-read";
let markingDecisions = false;

async function markDecisionsRead() {
  if (!import.meta.client || !user.value || markingDecisions) return;
  markingDecisions = true;
  try {
    const list = await $dropFetch<
      Array<{ id: string; nonce: string | null; read: boolean }>
    >("/api/v1/notifications");
    const unread = list.filter(
      (n) =>
        !n.read && n.nonce !== null && REQUEST_DECISION_NONCE.test(n.nonce),
    );
    const results = await Promise.allSettled(
      unread.map((n) =>
        $dropFetch<unknown>(
          `/api/v1/notifications/${encodeURIComponent(n.id)}/read`,
          { method: "POST" },
        ),
      ),
    );
    const marked = new Set(
      unread
        .filter((_, i) => results[i].status === "fulfilled")
        .map((n) => n.id),
    );
    if (marked.size < unread.length)
      // Left unread, so the count stays honest; the next visit retries.
      console.warn(
        `[requests] could not mark ${unread.length - marked.size} request notification(s) read`,
      );
    if (marked.size > 0) {
      const store = useNotifications();
      store.value = store.value.map((n) =>
        marked.has(n.id) ? { ...n, read: true } : n,
      );
    }
    // Sent even when nothing needed marking: the embedding client may still
    // be counting decisions something else has marked read since its last
    // poll. Not embedded, there is no one to tell.
    if (window.parent !== window)
      window.parent.postMessage({ type: REQUEST_DECISIONS_READ_MESSAGE }, "*");
  } catch (e) {
    // The decisions stay unread and the next visit to My requests retries.
    // Nothing the user can act on, so no message on the page.
    console.warn("[requests] could not mark request notifications read:", e);
  } finally {
    markingDecisions = false;
  }
}

onMounted(() => {
  if (view.value === "mine") void markDecisionsRead();
});

// ── Board ─────────────────────────────────────────────────────────────
type RequestItem = {
  id: string;
  title: string;
  description: string;
  igdbUrl: string | null;
  steamUrl: string | null;
  status: "Pending" | "Approved";
  gameId: string | null;
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
const boardLoading = ref(false);
const boardError = ref<string | null>(null);
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

async function fetchBoard() {
  boardLoading.value = true;
  boardError.value = null;
  try {
    requests.value = await $dropFetch<RequestItem[]>(
      "/api/v1/community/requests",
    );
  } catch (e) {
    boardError.value = errorMessage(e, t("requests.unknownError"));
  } finally {
    boardLoading.value = false;
  }
}

// ── My requests ───────────────────────────────────────────────────────
type MyRequest = {
  id: string;
  title: string;
  description: string;
  status: Status;
  createdAt: string;
  reviewedAt: string | null;
  denyReason: string | null;
  game: { id: string; name: string } | null;
  votes: { up: number; down: number };
};
const mine = ref<MyRequest[]>([]);
const mineLoading = ref(false);
const mineLoaded = ref(false);
const mineError = ref<string | null>(null);

async function fetchMine() {
  if (!user.value) return;
  mineLoading.value = true;
  mineError.value = null;
  try {
    mine.value = await $dropFetch<MyRequest[]>("/api/v1/store/requests/list");
    mineLoaded.value = true;
  } catch (e) {
    mineError.value = errorMessage(e, t("requests.unknownError"));
  } finally {
    mineLoading.value = false;
  }
}

await Promise.all([fetchBoard(), view.value === "mine" ? fetchMine() : null]);

// Per-row action errors and in-flight flags, keyed by request id.
const rowErrors = ref<Record<string, string>>({});
const voting = ref<Record<string, boolean>>({});
const withdrawing = ref<Record<string, boolean>>({});

// ── Voting ────────────────────────────────────────────────────────────
async function vote(req: RequestItem, v: "Up" | "Down") {
  if (!user.value) return;
  const clearing = req.votes.userVote === v;
  voting.value[req.id] = true;
  rowErrors.value[req.id] = "";
  try {
    const result = await $dropFetch<{ up: number; down: number }>(
      `/api/v1/store/requests/${req.id}/vote`,
      clearing ? { method: "DELETE" } : { method: "POST", body: { vote: v } },
    );
    req.votes = {
      ...req.votes,
      up: result.up,
      down: result.down,
      total: result.up + result.down,
      userVote: clearing ? null : v,
    };
  } catch (e) {
    rowErrors.value[req.id] = t("requests.voteFailed", [
      errorMessage(e, t("requests.unknownError")),
    ]);
  } finally {
    voting.value[req.id] = false;
  }
}

// ── Withdraw ──────────────────────────────────────────────────────────
// Not optimistic: the row only changes once the server says it worked.
async function withdraw(id: string) {
  withdrawing.value[id] = true;
  rowErrors.value[id] = "";
  try {
    await $dropFetch(`/api/v1/store/requests/${id}`, { method: "DELETE" });
    requests.value = requests.value.filter((r) => r.id !== id);
    const own = mine.value.find((r) => r.id === id);
    if (own) own.status = "Withdrawn";
  } catch (e) {
    rowErrors.value[id] = t("requests.withdrawFailed", [
      errorMessage(e, t("requests.unknownError")),
    ]);
  } finally {
    withdrawing.value[id] = false;
  }
}

// ── Create dialog ─────────────────────────────────────────────────────
const createDialogOpen = ref(false);
const creating = ref(false);
const newTitle = ref("");
const newDescription = ref("");
const newSteamUrl = ref("");
const createError = ref<string | undefined>();

/** The 409 body from create.post.ts (CreateRequestConflict). */
type Conflict = {
  reason: "duplicate" | "similar" | "in-library";
  request?: {
    id: string;
    title: string;
    status: string;
    mine: boolean;
    matchedName: string | null;
  };
  game?: { id: string; name: string };
};
const conflict = ref<Conflict | null>(null);
// The matched game's name, unless it just repeats the request's title.
const conflictMatchedName = computed(() => {
  const r = conflict.value?.request;
  const name = r?.matchedName?.trim();
  if (!r || !name) return null;
  return name.toLowerCase() === r.title.trim().toLowerCase() ? null : name;
});
const votingForConflict = ref(false);

type MetadataSearchResult = {
  id: string;
  name: string;
  icon: string;
  description: string;
  year: number;
  sourceId: string;
  sourceName: string;
};
const searchQuery = ref("");
// The query the current results belong to, so "no matches" is only shown
// once a search for what is typed has actually finished.
const searchedQuery = ref("");
const searchResults = ref<MetadataSearchResult[]>([]);
const failedProviders = ref<string[]>([]);
const searchError = ref<string | null>(null);
const searching = ref(false);
const matchedResult = ref<MetadataSearchResult | null>(null);
let searchDebounce: ReturnType<typeof setTimeout> | undefined;

function resetSearch() {
  if (searchDebounce) clearTimeout(searchDebounce);
  searchQuery.value = "";
  searchedQuery.value = "";
  searchResults.value = [];
  failedProviders.value = [];
  searchError.value = null;
  searching.value = false;
}

function openCreateDialog() {
  createError.value = undefined;
  conflict.value = null;
  createDialogOpen.value = true;
}

function onSearchInput() {
  if (searchDebounce) clearTimeout(searchDebounce);
  const q = searchQuery.value.trim();
  if (q.length < 2) {
    searchResults.value = [];
    failedProviders.value = [];
    searchError.value = null;
    searchedQuery.value = "";
    searching.value = false;
    return;
  }
  searching.value = true;
  searchDebounce = setTimeout(async () => {
    try {
      const response = await $dropFetch<{
        results: MetadataSearchResult[];
        failedProviders: Array<{ name: string }>;
      }>(`/api/v1/store/requests/metadata-search?q=${encodeURIComponent(q)}`);
      // Guard against a stale callback: only land results if the user
      // hasn't kept typing past this query.
      if (searchQuery.value.trim() !== q) return;
      searchResults.value = response.results;
      failedProviders.value = response.failedProviders.map((f) => f.name);
      searchError.value = null;
      searchedQuery.value = q;
    } catch (e) {
      if (searchQuery.value.trim() !== q) return;
      searchResults.value = [];
      failedProviders.value = [];
      searchError.value = errorMessage(e, t("requests.unknownError"));
      searchedQuery.value = q;
    } finally {
      if (searchQuery.value.trim() === q) searching.value = false;
    }
  }, 300);
}

function pickResult(r: MetadataSearchResult) {
  matchedResult.value = r;
  conflict.value = null;
  // Take the picked name as the title if the user hadn't already typed
  // one, so it matches the metadata source exactly.
  if (!newTitle.value.trim()) newTitle.value = r.name.slice(0, TITLE_MAX);
  resetSearch();
}

function clearMatch() {
  matchedResult.value = null;
  conflict.value = null;
  resetSearch();
}

/**
 * Steam URL from a picked metadata result. Steam URLs are deterministic
 * from the app id; other providers contribute the provider id only.
 */
function steamUrlFromMatch(r: MetadataSearchResult | null) {
  if (r?.sourceId === "Steam")
    return `https://store.steampowered.com/app/${r.id}`;
  return undefined;
}

async function createRequest(allowSimilar: boolean) {
  if (!newTitle.value.trim()) return;
  creating.value = true;
  createError.value = undefined;
  conflict.value = null;
  try {
    await $dropFetch("/api/v1/store/requests/create", {
      method: "POST",
      body: {
        title: newTitle.value.trim(),
        description: newDescription.value.trim(),
        steamUrl:
          steamUrlFromMatch(matchedResult.value) ??
          (newSteamUrl.value.trim() || undefined),
        metadata: matchedResult.value
          ? {
              sourceId: matchedResult.value.sourceId,
              id: matchedResult.value.id,
              name: matchedResult.value.name,
            }
          : undefined,
        allowSimilar: allowSimilar || undefined,
      },
    });
    newTitle.value = "";
    newDescription.value = "";
    newSteamUrl.value = "";
    matchedResult.value = null;
    resetSearch();
    createDialogOpen.value = false;
    await fetchBoard();
    if (mineLoaded.value) await fetchMine();
  } catch (e: unknown) {
    const err = e as { statusCode?: number; data?: { data?: Conflict } };
    if (err?.statusCode === 409 && err.data?.data?.reason) {
      conflict.value = err.data.data;
    } else {
      createError.value = errorMessage(e, t("requests.createFailed"));
    }
  } finally {
    creating.value = false;
  }
}

async function voteForConflict() {
  const target = conflict.value?.request;
  if (!target) return;
  votingForConflict.value = true;
  createError.value = undefined;
  try {
    await $dropFetch(`/api/v1/store/requests/${target.id}/vote`, {
      method: "POST",
      body: { vote: "Up" },
    });
    conflict.value = null;
    createDialogOpen.value = false;
    setView("board");
    await fetchBoard();
  } catch (e) {
    createError.value = t("requests.voteFailed", [
      errorMessage(e, t("requests.unknownError")),
    ]);
  } finally {
    votingForConflict.value = false;
  }
}
</script>
