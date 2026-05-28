<template>
  <div class="space-y-6">
    <!-- Header -->
    <div class="sm:flex sm:items-center sm:justify-between">
      <div>
        <h1 class="text-2xl font-semibold text-zinc-100">Game Requests</h1>
        <p class="mt-2 text-sm text-zinc-400">
          Triage games the community wants added to the catalog.
        </p>
      </div>
      <div class="mt-4 sm:mt-0 flex gap-2">
        <span
          class="inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium bg-yellow-500/10 text-yellow-400 ring-1 ring-yellow-500/20"
        >
          {{ pendingCount }} pending
        </span>
      </div>
    </div>

    <!-- Status filter -->
    <div class="flex gap-2 flex-wrap">
      <button
        v-for="f in filters"
        :key="f.value"
        :class="[
          'px-3 py-1.5 rounded-md text-sm font-medium transition-colors',
          statusFilter === f.value
            ? 'bg-blue-600 text-white'
            : 'bg-zinc-800 text-zinc-400 hover:text-zinc-100',
        ]"
        @click="statusFilter = f.value"
      >
        {{ f.label }}
      </button>
    </div>

    <!-- List -->
    <div v-if="loading" class="text-zinc-500 py-12 text-center">Loading…</div>
    <div v-else-if="requests.length === 0" class="py-12 text-center">
      <p class="text-zinc-500">No requests in this view.</p>
    </div>
    <div v-else class="space-y-3">
      <div
        v-for="req in requests"
        :key="req.id"
        class="flex gap-4 p-4 rounded-xl bg-zinc-800 ring-1 ring-white/5 hover:ring-blue-500/20 transition-all cursor-pointer"
        @click="openDetail(req)"
      >
        <!-- Vote pip -->
        <div
          class="flex flex-col items-center justify-center shrink-0 w-12 rounded-md bg-zinc-900/60 py-2"
        >
          <ChevronUpIcon class="size-4 text-zinc-500" />
          <span
            class="text-sm font-bold"
            :class="req.votes.up > 0 ? 'text-blue-400' : 'text-zinc-500'"
            >{{ req.votes.up }}</span
          >
          <span class="text-[10px] text-zinc-600">votes</span>
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
              {{ req.status }}
            </span>
          </div>
          <div class="flex items-center gap-4 mt-2 flex-wrap">
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
                  "Unknown"
                }}
              </span>
            </div>
            <RelativeTime :date="req.createdAt" class="text-xs text-zinc-600" />
            <span
              v-if="req.votes.down > 0"
              class="text-xs text-zinc-600 inline-flex items-center gap-1"
            >
              <ChevronDownIcon class="size-3" />
              {{ req.votes.down }}
            </span>
            <a
              v-if="req.steamUrl"
              :href="req.steamUrl"
              target="_blank"
              rel="noopener"
              class="text-xs text-zinc-500 hover:text-blue-400"
              @click.stop
              >Steam</a
            >
            <a
              v-if="req.igdbUrl"
              :href="req.igdbUrl"
              target="_blank"
              rel="noopener"
              class="text-xs text-zinc-500 hover:text-blue-400"
              @click.stop
              >IGDB</a
            >
            <span
              v-if="req.reviewer"
              class="text-xs text-zinc-600 ml-auto inline-flex items-center gap-1"
            >
              <span>reviewed by</span>
              <span class="text-zinc-400">{{
                req.reviewer.displayName || req.reviewer.username
              }}</span>
            </span>
          </div>
        </div>
      </div>
    </div>

    <!-- Detail / action modal -->
    <TransitionRoot as="template" :show="!!selected">
      <Dialog class="relative z-50" @close="closeDetail">
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
                v-if="selected"
                class="w-full max-w-2xl rounded-xl bg-zinc-900 p-6 shadow-xl ring-1 ring-white/10"
              >
                <div class="flex items-start justify-between mb-4">
                  <div class="min-w-0">
                    <DialogTitle
                      class="text-lg font-bold font-display text-zinc-100 truncate"
                    >
                      {{ selected.title }}
                    </DialogTitle>
                    <div class="flex items-center gap-3 mt-1 flex-wrap">
                      <span
                        :class="[
                          'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
                          statusClasses[selected.status],
                        ]"
                        >{{ selected.status }}</span
                      >
                      <span class="text-xs text-zinc-500"
                        >by
                        {{
                          selected.requester?.displayName ||
                          selected.requester?.username ||
                          "Unknown"
                        }}</span
                      >
                      <RelativeTime
                        :date="selected.createdAt"
                        class="text-xs text-zinc-600"
                      />
                      <span
                        class="text-xs text-zinc-500 inline-flex items-center gap-1"
                      >
                        <ChevronUpIcon class="size-3 text-blue-400" />
                        {{ selected.votes.up }}
                        <ChevronDownIcon class="size-3 text-zinc-600 ml-1" />
                        {{ selected.votes.down }}
                      </span>
                    </div>
                  </div>
                </div>

                <!-- Description -->
                <div v-if="selected.description" class="mb-4">
                  <h4 class="text-sm font-medium text-zinc-300 mb-1">
                    Request message
                  </h4>
                  <p
                    class="text-sm text-zinc-400 whitespace-pre-wrap rounded-md bg-zinc-800/50 p-3 ring-1 ring-white/5"
                  >
                    {{ selected.description }}
                  </p>
                </div>

                <!-- External links -->
                <div
                  v-if="selected.steamUrl || selected.igdbUrl"
                  class="flex gap-3 mb-4 text-xs"
                >
                  <a
                    v-if="selected.steamUrl"
                    :href="selected.steamUrl"
                    target="_blank"
                    rel="noopener"
                    class="text-zinc-400 hover:text-blue-400"
                    >Steam page ↗</a
                  >
                  <a
                    v-if="selected.igdbUrl"
                    :href="selected.igdbUrl"
                    target="_blank"
                    rel="noopener"
                    class="text-zinc-400 hover:text-blue-400"
                    >IGDB page ↗</a
                  >
                </div>

                <!-- Previous review notes -->
                <div
                  v-if="
                    selected.status !== 'Pending' && parsedReviewNotes !== null
                  "
                  class="mb-4 rounded-md bg-zinc-800/50 p-3 ring-1 ring-white/5"
                >
                  <h4 class="text-sm font-medium text-zinc-300 mb-1">
                    Review notes
                  </h4>
                  <pre
                    v-if="typeof parsedReviewNotes === 'object'"
                    class="text-xs text-zinc-400 whitespace-pre-wrap"
                    >{{ JSON.stringify(parsedReviewNotes, null, 2) }}</pre
                  >
                  <p v-else class="text-sm text-zinc-400 whitespace-pre-wrap">
                    {{ parsedReviewNotes }}
                  </p>
                </div>

                <!-- Action area: only for Pending -->
                <div
                  v-if="selected.status === 'Pending'"
                  class="border-t border-zinc-800 pt-4 mt-4 space-y-4"
                >
                  <!-- Metadata search -->
                  <div>
                    <label class="block text-sm font-medium text-zinc-300 mb-1"
                      >Pick metadata to attach</label
                    >
                    <p class="text-xs text-zinc-500 mb-2">
                      Same search as the request submitter — pick the match that
                      should become the catalog entry on approve.
                    </p>

                    <div
                      v-if="pickedMetadata"
                      class="flex items-center gap-3 rounded-md border border-blue-500/30 bg-blue-500/5 p-3"
                    >
                      <img
                        v-if="pickedMetadata.icon"
                        :src="pickedMetadata.icon"
                        class="size-12 rounded object-cover bg-zinc-800 shrink-0"
                        alt=""
                      />
                      <div class="flex-1 min-w-0">
                        <p class="text-sm font-medium text-zinc-100 truncate">
                          {{ pickedMetadata.name }}
                        </p>
                        <p class="text-xs text-zinc-400 truncate">
                          {{ pickedMetadata.sourceName
                          }}<span v-if="pickedMetadata.year">
                            &middot; {{ pickedMetadata.year }}</span
                          >
                        </p>
                      </div>
                      <button
                        type="button"
                        class="text-xs text-zinc-400 hover:text-red-400 shrink-0"
                        @click="pickedMetadata = null"
                      >
                        Clear
                      </button>
                    </div>
                    <div v-else>
                      <input
                        v-model="searchQuery"
                        type="text"
                        class="w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 outline-none focus:border-blue-500"
                        placeholder="Type a game name to search providers…"
                        @input="onSearchInput"
                      />
                      <div v-if="searching" class="mt-2 text-xs text-zinc-500">
                        Searching…
                      </div>
                      <div
                        v-else-if="searchResults.length > 0"
                        class="mt-2 max-h-56 overflow-y-auto rounded-md border border-zinc-700 bg-zinc-800/50 divide-y divide-zinc-700/50"
                      >
                        <button
                          v-for="r in searchResults"
                          :key="`${r.sourceId}-${r.id}`"
                          type="button"
                          class="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-zinc-700/40"
                          @click="pickedMetadata = r"
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
                        v-else-if="searchQuery.trim().length >= 2 && !searching"
                        class="mt-2 text-xs text-zinc-500"
                      >
                        No matches.
                      </p>
                    </div>
                  </div>

                  <!-- Optional: full-import path picker -->
                  <details class="text-sm">
                    <summary
                      class="cursor-pointer text-xs text-zinc-500 hover:text-zinc-300 select-none"
                    >
                      Import binary now? (pick an unimported library path)
                    </summary>
                    <div class="mt-2 space-y-2">
                      <p class="text-xs text-zinc-500">
                        Optional. Leave empty to just approve — you can run the
                        binary import later from the library page. If you pick
                        one, the game will be created in the catalog and the
                        import task starts immediately.
                      </p>
                      <div v-if="libraryOptions.length === 0">
                        <p class="text-xs text-zinc-500">
                          No unimported games found in any library.
                        </p>
                      </div>
                      <select
                        v-else
                        v-model="pickedLibraryOption"
                        class="w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100"
                      >
                        <option :value="''">
                          — Don't import a binary right now —
                        </option>
                        <option
                          v-for="opt in libraryOptions"
                          :key="opt.key"
                          :value="opt.key"
                        >
                          {{ opt.label }}
                        </option>
                      </select>
                    </div>
                  </details>

                  <!-- Deny reason -->
                  <div>
                    <label class="block text-sm font-medium text-zinc-300 mb-1"
                      >Deny reason (optional)</label
                    >
                    <textarea
                      v-model="denyReason"
                      rows="2"
                      class="w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 outline-none focus:border-blue-500 resize-none"
                      placeholder="Shown to the requester. Only used when denying."
                    />
                  </div>

                  <p v-if="actionError" class="text-sm text-red-400">
                    {{ actionError }}
                  </p>
                </div>

                <div class="flex justify-end gap-2 mt-4 flex-wrap">
                  <button
                    class="px-4 py-2 rounded-md text-sm text-zinc-300 hover:text-zinc-100"
                    @click="closeDetail"
                  >
                    Close
                  </button>
                  <template v-if="selected.status === 'Pending'">
                    <LoadingButton
                      :loading="denying"
                      :disabled="approving"
                      class="px-4 py-2 rounded-md text-sm font-medium bg-red-600/80 hover:bg-red-500 text-white disabled:opacity-50"
                      @click="denyRequest"
                    >
                      Deny
                    </LoadingButton>
                    <LoadingButton
                      :loading="approving"
                      :disabled="denying || !pickedMetadata"
                      class="px-4 py-2 rounded-md text-sm font-medium bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-50"
                      @click="approveRequest"
                    >
                      Approve
                    </LoadingButton>
                  </template>
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
  Dialog,
  DialogPanel,
  DialogTitle,
  TransitionChild,
  TransitionRoot,
} from "@headlessui/vue";
import { ChevronUpIcon, ChevronDownIcon } from "@heroicons/vue/24/outline";
import { useObject } from "~/composables/objects";

definePageMeta({ layout: "admin" });
useHead({ title: "Game Requests" });

type RequestRow = {
  id: string;
  title: string;
  description: string;
  igdbUrl: string | null;
  steamUrl: string | null;
  status: "Pending" | "Approved" | "Denied" | "Withdrawn";
  reviewNotes: string | null;
  gameId: string | null;
  createdAt: string;
  reviewedAt: string | null;
  requester: {
    id: string;
    username: string;
    displayName: string;
    profilePictureObjectId: string;
  } | null;
  reviewer: {
    id: string;
    username: string;
    displayName: string;
    profilePictureObjectId: string;
  } | null;
  votes: { up: number; down: number; total: number };
};

type MetadataSearchResult = {
  id: string;
  name: string;
  icon: string;
  description: string;
  year: number;
  sourceId: string;
  sourceName: string;
};

type UnimportedGameRow = {
  game: string;
  library: { id: string; name: string };
};

const statusClasses: Record<string, string> = {
  Pending: "bg-yellow-500/10 text-yellow-400 ring-1 ring-yellow-500/20",
  Approved: "bg-green-500/10 text-green-400 ring-1 ring-green-500/20",
  Denied: "bg-red-500/10 text-red-400 ring-1 ring-red-500/20",
  Withdrawn: "bg-zinc-500/10 text-zinc-400 ring-1 ring-zinc-500/20",
};

const filters = [
  { value: "Pending", label: "Pending" },
  { value: "Approved", label: "Approved" },
  { value: "Denied", label: "Denied" },
  { value: "Withdrawn", label: "Withdrawn" },
  { value: "all", label: "All" },
] as const;

const statusFilter = ref<(typeof filters)[number]["value"]>("Pending");
const loading = ref(false);
const requests = ref<RequestRow[]>([]);
const pendingCount = ref(0);

async function fetchRequests() {
  loading.value = true;
  try {
    const qs =
      statusFilter.value === "all"
        ? ""
        : `?status=${encodeURIComponent(statusFilter.value)}`;
    requests.value = (await $dropFetch(
      `/api/v1/admin/requests/list${qs}`,
    )) as RequestRow[];
  } catch {
    requests.value = [];
  } finally {
    loading.value = false;
  }
}

async function refreshPendingCount() {
  try {
    const pending = (await $dropFetch(
      "/api/v1/admin/requests/list?status=Pending",
    )) as RequestRow[];
    pendingCount.value = pending.length;
  } catch {
    /* ignore */
  }
}

await fetchRequests();
await refreshPendingCount();

watch(statusFilter, () => fetchRequests());

// ── Detail modal state ────────────────────────────────────────────────
const selected = ref<RequestRow | null>(null);
const pickedMetadata = ref<MetadataSearchResult | null>(null);
const searchQuery = ref("");
const searchResults = ref<MetadataSearchResult[]>([]);
const searching = ref(false);
const denyReason = ref("");
const actionError = ref("");
const approving = ref(false);
const denying = ref(false);
let searchDebounce: ReturnType<typeof setTimeout> | undefined;

// Parsed review notes: approve stores JSON, deny stores plain text. We
// try JSON.parse and fall back to the raw string so the modal can show
// both gracefully.
const parsedReviewNotes = computed(() => {
  const notes = selected.value?.reviewNotes;
  if (!notes) return null;
  try {
    return JSON.parse(notes);
  } catch {
    return notes;
  }
});

function openDetail(req: RequestRow) {
  selected.value = req;
  pickedMetadata.value = null;
  searchQuery.value = "";
  searchResults.value = [];
  denyReason.value = "";
  actionError.value = "";
}

function closeDetail() {
  selected.value = null;
}

function onSearchInput() {
  if (searchDebounce) clearTimeout(searchDebounce);
  const q = searchQuery.value.trim();
  if (q.length < 2) {
    searchResults.value = [];
    searching.value = false;
    return;
  }
  searching.value = true;
  searchDebounce = setTimeout(async () => {
    try {
      // Same provider search the requester used; gated on store:read so
      // it works for admins too (system ACL inherits).
      const results = await $dropFetch<MetadataSearchResult[]>(
        `/api/v1/store/requests/metadata-search?q=${encodeURIComponent(q)}`,
      );
      if (searchQuery.value.trim() === q) {
        searchResults.value = results ?? [];
      }
    } catch {
      searchResults.value = [];
    } finally {
      searching.value = false;
    }
  }, 300);
}

// ── Unimported-library options for the optional full-import path ──────
type LibraryOption = {
  key: string;
  label: string;
  libraryId: string;
  path: string;
};
const libraryOptions = ref<LibraryOption[]>([]);
const pickedLibraryOption = ref("");

async function loadLibraryOptions() {
  try {
    const data = (await $dropFetch("/api/v1/admin/library/libraries")) as {
      unimportedGames: Record<string, string[]>;
      libraries: Array<{ id: string; name: string }>;
    };
    const libMap = Object.fromEntries(data.libraries.map((l) => [l.id, l]));
    const opts: LibraryOption[] = [];
    for (const [libraryId, paths] of Object.entries(data.unimportedGames)) {
      const lib = libMap[libraryId];
      if (!lib) continue;
      for (const p of paths) {
        opts.push({
          key: `${libraryId}::${p}`,
          libraryId,
          path: p,
          label: `${p}  (${lib.name})`,
        });
      }
    }
    libraryOptions.value = opts;
  } catch {
    libraryOptions.value = [];
  }
}
await loadLibraryOptions();

async function approveRequest() {
  if (!selected.value || !pickedMetadata.value) return;
  approving.value = true;
  actionError.value = "";
  try {
    const body: Record<string, unknown> = {
      metadata: {
        sourceId: pickedMetadata.value.sourceId,
        id: pickedMetadata.value.id,
        name: pickedMetadata.value.name,
      },
    };
    if (pickedLibraryOption.value) {
      const opt = libraryOptions.value.find(
        (o) => o.key === pickedLibraryOption.value,
      );
      if (opt) {
        body.library = opt.libraryId;
        body.path = opt.path;
        body.type = "Game";
      }
    }
    await $dropFetch(`/api/v1/admin/requests/${selected.value.id}/approve`, {
      method: "POST",
      body,
    });
    selected.value = null;
    await fetchRequests();
    await refreshPendingCount();
  } catch (e: unknown) {
    const err = e as Error & {
      data?: { message?: string; statusMessage?: string };
    };
    actionError.value =
      err?.data?.statusMessage ||
      err?.data?.message ||
      err?.message ||
      "Failed to approve.";
  } finally {
    approving.value = false;
  }
}

async function denyRequest() {
  if (!selected.value) return;
  denying.value = true;
  actionError.value = "";
  try {
    await $dropFetch(`/api/v1/admin/requests/${selected.value.id}/deny`, {
      method: "POST",
      body: { reason: denyReason.value.trim() || undefined },
    });
    selected.value = null;
    await fetchRequests();
    await refreshPendingCount();
  } catch (e: unknown) {
    const err = e as Error & {
      data?: { message?: string; statusMessage?: string };
    };
    actionError.value =
      err?.data?.statusMessage ||
      err?.data?.message ||
      err?.message ||
      "Failed to deny.";
  } finally {
    denying.value = false;
  }
}
</script>
