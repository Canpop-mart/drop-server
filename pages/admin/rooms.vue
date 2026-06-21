<template>
  <div>
    <div class="sm:flex sm:items-center">
      <div class="sm:flex-auto">
        <h1 class="text-base font-semibold text-zinc-100">Co-op Rooms</h1>
        <p class="mt-2 text-sm text-zinc-400">
          Active ZeroTier co-op sessions. Delete a room to end it for everyone,
          or reap rooms that have already expired.
        </p>
      </div>
      <div class="mt-4 sm:ml-16 sm:mt-0 sm:flex-none">
        <button
          :disabled="busy"
          class="block rounded-md bg-zinc-800 px-3 py-2 text-center text-sm font-semibold text-zinc-100 shadow-sm transition-colors hover:bg-zinc-700 disabled:opacity-50"
          @click="reapExpired"
        >
          Reap expired
        </button>
      </div>
    </div>
    <div class="mt-8 flow-root">
      <div class="-mx-4 -my-2 overflow-x-auto sm:-mx-6 lg:-mx-8">
        <div class="inline-block min-w-full py-2 align-middle sm:px-6 lg:px-8">
          <div
            class="overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900 shadow"
          >
            <table class="min-w-full divide-y divide-zinc-700">
              <thead>
                <tr class="bg-zinc-800/50">
                  <th
                    class="py-3.5 pl-4 pr-3 text-left text-sm font-semibold text-zinc-100 sm:pl-6"
                  >
                    Code
                  </th>
                  <th
                    class="px-3 py-3.5 text-left text-sm font-semibold text-zinc-100"
                  >
                    Host
                  </th>
                  <th
                    class="px-3 py-3.5 text-left text-sm font-semibold text-zinc-100"
                  >
                    Players
                  </th>
                  <th
                    class="px-3 py-3.5 text-left text-sm font-semibold text-zinc-100"
                  >
                    Created
                  </th>
                  <th
                    class="px-3 py-3.5 text-left text-sm font-semibold text-zinc-100"
                  >
                    Expires
                  </th>
                  <th class="relative py-3.5 pl-3 pr-4 sm:pr-6">
                    <span class="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody class="divide-y divide-zinc-700">
                <tr
                  v-for="room in rooms"
                  :key="room.id"
                  class="hover:bg-zinc-800/50 transition-colors"
                >
                  <td
                    class="whitespace-nowrap py-4 pl-4 pr-3 text-sm font-mono font-medium text-blue-300 sm:pl-6"
                  >
                    {{ room.shortCode }}
                  </td>
                  <td class="whitespace-nowrap px-3 py-4 text-sm text-zinc-300">
                    {{ room.hostClientName || room.hostClientId }}
                  </td>
                  <td class="whitespace-nowrap px-3 py-4 text-sm text-zinc-400">
                    {{ room.members.length }}
                  </td>
                  <td class="whitespace-nowrap px-3 py-4 text-sm text-zinc-400">
                    {{ fmt(room.createdAt) }}
                  </td>
                  <td
                    class="whitespace-nowrap px-3 py-4 text-sm"
                    :class="
                      expiringSoon(room.expiresAt)
                        ? 'text-amber-400'
                        : 'text-zinc-400'
                    "
                  >
                    {{ room.expiresAt ? fmt(room.expiresAt) : "—" }}
                  </td>
                  <td
                    class="relative whitespace-nowrap py-4 pl-3 pr-4 text-right text-sm font-medium sm:pr-6"
                  >
                    <button
                      v-if="confirmId !== room.id"
                      class="text-red-400 hover:text-red-300 transition-colors"
                      @click="confirmId = room.id"
                    >
                      Delete
                    </button>
                    <span v-else class="inline-flex items-center gap-3">
                      <button
                        class="font-semibold text-red-400 hover:text-red-300"
                        @click="deleteRoom(room.id)"
                      >
                        Confirm
                      </button>
                      <button
                        class="text-zinc-400 hover:text-zinc-300"
                        @click="confirmId = null"
                      >
                        Cancel
                      </button>
                    </span>
                  </td>
                </tr>
                <tr v-if="rooms.length === 0">
                  <td
                    colspan="6"
                    class="px-6 py-8 text-center text-sm text-zinc-500"
                  >
                    No active co-op rooms.
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
interface AdminRoomMember {
  clientId: string;
  clientName: string;
  status: string;
  isHost: boolean;
  joinedAt: string;
}
interface AdminRoom {
  id: string;
  shortCode: string;
  networkId: string;
  gameId: string | null;
  name: string | null;
  hostClientId: string;
  hostClientName: string | null;
  createdAt: string;
  expiresAt: string | null;
  members: AdminRoomMember[];
}

useHead({ title: "Co-op Rooms" });
definePageMeta({ layout: "admin" });

const rooms = ref<AdminRoom[]>([]);
const busy = ref(false);
const confirmId = ref<string | null>(null);

async function load() {
  rooms.value = (await $dropFetch("/api/v1/admin/room")) as AdminRoom[];
}
await load();

function fmt(iso: string) {
  return new Date(iso).toLocaleString();
}
function expiringSoon(iso: string | null) {
  return !!iso && new Date(iso).getTime() - Date.now() < 3_600_000;
}

async function deleteRoom(id: string) {
  confirmId.value = null;
  busy.value = true;
  try {
    await $dropFetch(`/api/v1/admin/room/${id}`, { method: "DELETE" });
    await load();
  } finally {
    busy.value = false;
  }
}

async function reapExpired() {
  busy.value = true;
  try {
    await $dropFetch("/api/v1/admin/room/reset", { method: "POST" });
    await load();
  } finally {
    busy.value = false;
  }
}
</script>
