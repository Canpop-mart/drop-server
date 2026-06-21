<template>
  <div>
    <div class="sm:flex sm:items-center">
      <div class="sm:flex-auto">
        <h1 class="text-base font-semibold text-zinc-100">Devices</h1>
        <p class="mt-2 text-sm text-zinc-400">
          Paired client devices. Rename a device for easier identification in
          co-op rooms and activity.
        </p>
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
                    Device
                  </th>
                  <th
                    class="px-3 py-3.5 text-left text-sm font-semibold text-zinc-100"
                  >
                    Platform
                  </th>
                  <th
                    class="px-3 py-3.5 text-left text-sm font-semibold text-zinc-100"
                  >
                    User
                  </th>
                  <th
                    class="px-3 py-3.5 text-left text-sm font-semibold text-zinc-100"
                  >
                    Last seen
                  </th>
                  <th
                    class="px-3 py-3.5 text-left text-sm font-semibold text-zinc-100"
                  >
                    Rooms
                  </th>
                  <th class="relative py-3.5 pl-3 pr-4 sm:pr-6">
                    <span class="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody class="divide-y divide-zinc-700">
                <tr
                  v-for="d in devices"
                  :key="d.id"
                  class="hover:bg-zinc-800/50 transition-colors"
                >
                  <td
                    class="whitespace-nowrap py-4 pl-4 pr-3 text-sm font-medium text-zinc-100 sm:pl-6"
                  >
                    <input
                      v-if="editingId === d.id"
                      v-model="editName"
                      maxlength="64"
                      class="w-44 rounded-md bg-zinc-800 px-2 py-1 text-zinc-100 outline-none ring-1 ring-zinc-700 focus:ring-2 focus:ring-blue-500"
                      @keyup.enter="saveName(d.id)"
                      @keyup.esc="editingId = null"
                    />
                    <span v-else>{{ d.name }}</span>
                  </td>
                  <td class="whitespace-nowrap px-3 py-4 text-sm text-zinc-400">
                    {{ d.platform }}
                  </td>
                  <td class="whitespace-nowrap px-3 py-4 text-sm text-zinc-400">
                    {{ d.userName }}
                  </td>
                  <td class="whitespace-nowrap px-3 py-4 text-sm text-zinc-400">
                    {{ fmt(d.lastConnected) }}
                  </td>
                  <td class="whitespace-nowrap px-3 py-4 text-sm text-zinc-400">
                    {{ d.hostedRoomCount }} hosted ·
                    {{ d.memberRoomCount }} joined
                  </td>
                  <td
                    class="relative whitespace-nowrap py-4 pl-3 pr-4 text-right text-sm font-medium sm:pr-6"
                  >
                    <button
                      v-if="editingId !== d.id"
                      class="text-blue-400 hover:text-blue-300 transition-colors"
                      @click="startEdit(d)"
                    >
                      Rename
                    </button>
                    <span v-else class="inline-flex items-center gap-3">
                      <button
                        :disabled="busy || editName.trim().length === 0"
                        class="font-semibold text-blue-400 hover:text-blue-300 disabled:opacity-50"
                        @click="saveName(d.id)"
                      >
                        Save
                      </button>
                      <button
                        class="text-zinc-400 hover:text-zinc-300"
                        @click="editingId = null"
                      >
                        Cancel
                      </button>
                    </span>
                  </td>
                </tr>
                <tr v-if="devices.length === 0">
                  <td
                    colspan="6"
                    class="px-6 py-8 text-center text-sm text-zinc-500"
                  >
                    No paired devices.
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
interface AdminDevice {
  id: string;
  name: string;
  platform: string;
  lastConnected: string;
  userId: string;
  userName: string;
  hostedRoomCount: number;
  memberRoomCount: number;
}

useHead({ title: "Devices" });
definePageMeta({ layout: "admin" });

const devices = ref<AdminDevice[]>([]);
const busy = ref(false);
const editingId = ref<string | null>(null);
const editName = ref("");

async function load() {
  devices.value = (await $dropFetch("/api/v1/admin/client")) as AdminDevice[];
}
await load();

function fmt(iso: string) {
  return new Date(iso).toLocaleString();
}

function startEdit(d: AdminDevice) {
  editingId.value = d.id;
  editName.value = d.name;
}

async function saveName(id: string) {
  const name = editName.value.trim();
  if (name.length === 0) return;
  busy.value = true;
  try {
    await $dropFetch(`/api/v1/admin/client/${id}`, {
      method: "PATCH",
      body: { name },
    });
    editingId.value = null;
    await load();
  } finally {
    busy.value = false;
  }
}
</script>
