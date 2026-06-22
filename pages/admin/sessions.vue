<template>
  <div>
    <div class="sm:flex sm:items-center">
      <div class="sm:flex-auto">
        <h1 class="text-base font-semibold text-zinc-100">Sessions</h1>
        <p class="mt-2 text-sm text-zinc-400">
          Every client pairing, newest first. A device that re-pairs (reinstall,
          re-auth) appears once per pairing. To manage unique devices, use the
          Devices page.
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
                </tr>
              </thead>
              <tbody class="divide-y divide-zinc-700">
                <tr
                  v-for="c in clients"
                  :key="c.id"
                  class="hover:bg-zinc-800/50 transition-colors"
                >
                  <td
                    class="whitespace-nowrap py-4 pl-4 pr-3 text-sm font-medium text-zinc-100 sm:pl-6"
                  >
                    {{ c.name }}
                  </td>
                  <td class="whitespace-nowrap px-3 py-4 text-sm text-zinc-400">
                    {{ c.platform }}
                  </td>
                  <td class="whitespace-nowrap px-3 py-4 text-sm text-zinc-400">
                    {{ c.userName }}
                  </td>
                  <td class="whitespace-nowrap px-3 py-4 text-sm text-zinc-400">
                    {{ fmt(c.lastConnected) }}
                  </td>
                  <td class="whitespace-nowrap px-3 py-4 text-sm text-zinc-400">
                    {{ c.hostedRoomCount }} hosted,
                    {{ c.memberRoomCount }} joined
                  </td>
                </tr>
                <tr v-if="clients.length === 0">
                  <td
                    colspan="5"
                    class="px-6 py-8 text-center text-sm text-zinc-500"
                  >
                    No sessions yet.
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
interface RawClient {
  id: string;
  name: string;
  platform: string;
  lastConnected: string;
  userId: string;
  userName: string;
  hostedRoomCount: number;
  memberRoomCount: number;
}

useHead({ title: "Sessions" });
definePageMeta({ layout: "admin" });

const clients = ref<RawClient[]>([]);
async function load() {
  clients.value = (await $dropFetch("/api/v1/admin/client")) as RawClient[];
}
await load();

function fmt(iso: string) {
  return new Date(iso).toLocaleString();
}
</script>
