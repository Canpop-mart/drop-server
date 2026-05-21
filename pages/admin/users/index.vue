<template>
  <div>
    <div class="sm:flex sm:items-center">
      <div class="sm:flex-auto">
        <h1 class="text-base font-semibold text-zinc-100">
          {{ $t("header.admin.users") }}
        </h1>
        <p class="mt-2 text-sm text-zinc-400">
          {{ $t("users.admin.description") }}
        </p>
      </div>
      <div class="mt-4 sm:ml-16 sm:mt-0 sm:flex-none">
        <NuxtLink
          to="/admin/users/auth"
          class="block rounded-md bg-blue-600 px-3 py-2 text-center text-sm font-semibold text-white shadow-sm transition-all duration-200 hover:bg-blue-500 hover:scale-105 hover:shadow-lg active:scale-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
        >
          <i18n-t keypath="users.admin.authLink" tag="span" scope="global">
            <template #arrow>
              <span aria-hidden="true">{{ $t("chars.arrow") }}</span>
            </template>
          </i18n-t>
        </NuxtLink>
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
                    scope="col"
                    class="py-3.5 pl-4 pr-3 text-left text-sm font-semibold text-zinc-100 sm:pl-6"
                  >
                    {{ $t("users.admin.displayNameHeader") }}
                  </th>
                  <th
                    scope="col"
                    class="px-3 py-3.5 text-left text-sm font-semibold text-zinc-100"
                  >
                    {{ $t("users.admin.usernameHeader") }}
                  </th>
                  <th
                    scope="col"
                    class="px-3 py-3.5 text-left text-sm font-semibold text-zinc-100"
                  >
                    {{ $t("users.admin.emailHeader") }}
                  </th>
                  <th
                    scope="col"
                    class="px-3 py-3.5 text-left text-sm font-semibold text-zinc-100"
                  >
                    {{ $t("users.admin.adminHeader") }}
                  </th>
                  <th
                    scope="col"
                    class="px-3 py-3.5 text-left text-sm font-semibold text-zinc-100"
                  >
                    {{ $t("users.admin.authoptionsHeader") }}
                  </th>
                  <th scope="col" class="relative py-3.5 pl-3 pr-4 sm:pr-6">
                    <span class="sr-only">
                      {{ $t("users.admin.srEditLabel") }}
                    </span>
                  </th>
                </tr>
              </thead>
              <tbody class="divide-y divide-zinc-700">
                <tr
                  v-for="user in users"
                  :key="user.id"
                  class="hover:bg-zinc-800/50 transition-colors duration-150"
                >
                  <td
                    class="whitespace-nowrap py-4 pl-4 pr-3 text-sm font-medium text-zinc-100 sm:pl-6"
                  >
                    {{ user.displayName }}
                  </td>
                  <td class="whitespace-nowrap px-3 py-4 text-sm text-zinc-400">
                    {{ user.username }}
                  </td>
                  <td class="whitespace-nowrap px-3 py-4 text-sm text-zinc-400">
                    {{ user.email }}
                  </td>
                  <td class="whitespace-nowrap px-3 py-4 text-sm">
                    <span
                      :class="[
                        'inline-flex items-center rounded-md px-2 py-1 text-xs font-medium ring-1 ring-inset',
                        user.admin
                          ? 'bg-blue-400/10 text-blue-400 ring-blue-400/20'
                          : 'bg-zinc-400/10 text-zinc-400 ring-zinc-400/20',
                      ]"
                    >
                      {{
                        user.admin
                          ? $t("users.admin.adminUserLabel")
                          : $t("users.admin.normalUserLabel")
                      }}
                    </span>
                  </td>
                  <td class="whitespace-nowrap px-3 py-4 text-sm text-zinc-400">
                    <div class="flex flex-wrap gap-1">
                      <span
                        v-for="mec in user.authMecs"
                        :key="mec.mec"
                        class="inline-flex items-center rounded-md bg-zinc-400/10 px-2 py-1 text-xs font-medium text-zinc-400 ring-1 ring-inset ring-zinc-400/20"
                      >
                        {{ mec.mec }}
                      </span>
                    </div>
                  </td>
                  <td
                    class="relative whitespace-nowrap py-4 pl-3 pr-4 text-right text-sm font-medium sm:pr-6"
                  >
                    <Menu as="div" class="relative inline-block text-left">
                      <MenuButton
                        class="-m-2.5 block p-2.5 text-zinc-400 hover:text-zinc-300 transition-colors duration-200"
                      >
                        <span class="sr-only">
                          {{ $t("users.admin.srUserActions") }}
                        </span>
                        <EllipsisHorizontalIcon
                          class="h-5 w-5"
                          aria-hidden="true"
                        />
                      </MenuButton>
                      <transition
                        enter-active-class="transition ease-out duration-100"
                        enter-from-class="transform opacity-0 scale-95"
                        enter-to-class="transform opacity-100 scale-100"
                        leave-active-class="transition ease-in duration-75"
                        leave-from-class="transform opacity-100 scale-100"
                        leave-to-class="transform opacity-0 scale-95"
                      >
                        <MenuItems
                          class="absolute right-0 z-10 mt-0.5 w-48 origin-top-right rounded-md bg-zinc-900 py-2 shadow-lg ring-1 ring-zinc-100/5 focus:outline-none"
                        >
                          <MenuItem v-slot="{ active }">
                            <button
                              :class="[
                                active ? 'bg-zinc-800 outline-none' : '',
                                'block w-full px-3 py-1 text-left text-sm/6 text-zinc-100 transition-colors duration-200',
                              ]"
                              @click="() => (userToResetLink = user)"
                            >
                              {{ $t("users.admin.generateResetLink") }}
                            </button>
                          </MenuItem>
                          <MenuItem v-slot="{ active }">
                            <button
                              :class="[
                                active ? 'bg-zinc-800 outline-none' : '',
                                'block w-full px-3 py-1 text-left text-sm/6 text-zinc-100 transition-colors duration-200',
                              ]"
                              @click="() => (userToSetPassword = user)"
                            >
                              {{ $t("users.admin.setPasswordAction") }}
                            </button>
                          </MenuItem>
                          <MenuItem
                            v-if="user.id !== currentUser?.id"
                            v-slot="{ active }"
                          >
                            <button
                              :class="[
                                active ? 'bg-zinc-800 outline-none' : '',
                                'block w-full px-3 py-1 text-left text-sm/6 text-red-400 transition-colors duration-200',
                              ]"
                              @click="() => setUserToDelete(user)"
                            >
                              {{ $t("users.admin.delete") }}
                            </button>
                          </MenuItem>
                        </MenuItems>
                      </transition>
                    </Menu>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
    <ModalDeleteUser v-model="userToDelete" />
    <ModalGenerateResetLink v-model="userToResetLink" />
    <ModalSetUserPassword v-model="userToSetPassword" />
  </div>
</template>

<script setup lang="ts">
import { Menu, MenuButton, MenuItem, MenuItems } from "@headlessui/vue";
import { EllipsisHorizontalIcon } from "@heroicons/vue/20/solid";
import { useUsers } from "~/composables/users";
import type { UserModel } from "~/prisma/client/models";

useHead({
  title: "Users",
});

definePageMeta({
  layout: "admin",
});

const users = useUsers();
const currentUser = useUser();

if (!users.value) {
  await fetchUsers();
}

const userToDelete = ref();
const userToResetLink = ref<UserModel | undefined>();
const userToSetPassword = ref<UserModel | undefined>();

const setUserToDelete = (user: UserModel) => (userToDelete.value = user);
</script>
