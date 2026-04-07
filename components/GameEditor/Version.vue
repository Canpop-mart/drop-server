<!-- eslint-disable vue/no-v-html -->
<template>
  <div v-if="game && unimportedVersions" class="px-4 sm:px-6 lg:px-8 py-8">
    <div class="sm:flex sm:items-center">
      <div class="sm:flex-auto">
        <h1 class="text-base font-semibold text-white">
          {{ $t("library.admin.version.title") }}
        </h1>
        <p class="mt-2 text-sm text-gray-300">
          {{ $t("library.admin.version.description") }}
        </p>
      </div>
      <div class="mt-4 sm:mt-0 sm:ml-16 sm:flex-none">
        <NuxtLink
          :href="canImport ? `/admin/library/${game.id}/import` : ''"
          type="button"
          :class="[
            canImport ? 'bg-blue-600 hover:bg-blue-700' : 'bg-blue-800/50',
            'inline-flex w-fit items-center gap-x-2 rounded-md  px-3 py-1 text-sm font-semibold font-display text-white shadow-sm  focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600',
          ]"
        >
          {{
            canImport
              ? $t("library.admin.import.version.import")
              : $t("library.admin.import.version.noVersions")
          }}
        </NuxtLink>
      </div>
    </div>
    <div class="mt-8 flow-root">
      <div class="-mx-4 -my-2 overflow-x-auto sm:-mx-6 lg:-mx-8">
        <div class="inline-block min-w-full py-2 align-middle sm:px-6 lg:px-8">
          <table class="relative min-w-full divide-y divide-white/15">
            <thead>
              <tr>
                <th></th>
                <th
                  scope="col"
                  class="py-3 pr-3 pl-4 text-left text-xs font-medium tracking-wide text-gray-400 uppercase sm:pl-0"
                >
                  {{ $t("library.admin.version.table.name") }}
                </th>
                <th
                  scope="col"
                  class="px-3 py-3 text-left text-xs font-medium tracking-wide text-gray-400 uppercase"
                >
                  {{ $t("library.admin.version.table.path") }}
                </th>
                <th
                  scope="col"
                  class="px-3 py-3 text-left text-xs font-medium tracking-wide text-gray-400 uppercase"
                >
                  {{ $t("library.admin.version.table.delta") }}
                </th>
                <th
                  scope="col"
                  class="px-3 py-3 text-left text-xs font-medium tracking-wide text-gray-400 uppercase"
                >
                  {{ $t("library.admin.version.table.setup") }}
                </th>
                <th
                  scope="col"
                  class="px-3 py-3 text-left text-xs font-medium tracking-wide text-gray-400 uppercase"
                >
                  {{ $t("library.admin.version.table.launch") }}
                </th>
                <th scope="col" class="py-3 pr-4 pl-3 sm:pr-0">
                  <span class="sr-only">{{ $t("common.edit") }}</span>
                </th>
              </tr>
            </thead>
            <draggable
              :list="game.versions"
              handle=".handle"
              class="divide-y divide-white/10"
              tag="tbody"
              @update="() => updateVersionOrder()"
            >
              <template #item="{ element: version }: { element: VersionType }">
                <tr :key="version.versionId">
                  <!-- Normal display row -->
                  <td>
                    <Bars3Icon
                      class="cursor-move w-6 h-6 text-zinc-400 handle"
                    />
                  </td>
                  <td class="py-4 pr-3 pl-4 sm:pl-0">
                    <div class="flex flex-col">
                      <span
                        class="text-sm font-medium whitespace-nowrap text-white"
                        >{{ version.displayName ?? version.versionPath }}</span
                      >
                      <span class="text-xs text-zinc-500 mono">{{
                        version.versionId
                      }}</span>
                    </div>
                  </td>
                  <td class="px-3 py-4 text-sm whitespace-nowrap text-gray-400">
                    {{ version.versionPath }}
                  </td>
                  <td class="px-3 py-4 text-sm whitespace-nowrap text-gray-400">
                    {{ version.delta }}
                  </td>

                  <td class="px-3 py-4 text-sm whitespace-nowrap text-gray-400">
                    <ul class="space-y-2">
                      <GameEditorVersionConfig
                        v-for="config in version.setups"
                        :key="config.setupId"
                        :config="config"
                      />
                      <li
                        v-if="version.setups.length == 0"
                        class="text-xs uppercase font-display text-zinc-700 font-semibold"
                      >
                        {{ $t("library.admin.version.noSetups") }}
                      </li>
                    </ul>
                  </td>
                  <td class="px-3 py-4 text-sm whitespace-nowrap text-gray-400">
                    <div v-if="version.onlySetup">
                      {{ $t("library.admin.version.setupOnly") }}
                    </div>
                    <ul v-else class="space-y-2">
                      <GameEditorVersionConfig
                        v-for="config in version.launches"
                        :key="config.launchId"
                        :config="config"
                      />
                    </ul>
                  </td>
                  <td
                    class="py-4 pr-4 pl-3 text-right text-sm font-medium whitespace-nowrap sm:pr-0 space-x-2"
                  >
                    <button
                      class="text-blue-400 hover:text-blue-300"
                      @click="() => startEditing(version)"
                    >
                      {{ $t("common.edit") }}
                    </button>
                    <button
                      class="text-red-400 hover:text-red-300"
                      @click="() => deleteVersion(version.versionId)"
                    >
                      {{ $t("common.delete") }}
                    </button>
                  </td>
                </tr>
              </template>
            </draggable>
          </table>
        </div>
      </div>
    </div>

    <!-- Edit panel (shown below table when editing a version) -->
    <div
      v-if="editingVersionId"
      class="mt-6 rounded-xl bg-zinc-900 ring-1 ring-zinc-800 p-6"
    >
      <div class="flex items-center justify-between mb-6">
        <h2 class="text-lg font-semibold text-white font-display">
          {{ $t("library.admin.version.edit.title") }}
          <span class="text-zinc-400 text-sm font-normal ml-2 mono">{{
            editingVersionId
          }}</span>
        </h2>
        <button
          class="text-zinc-400 hover:text-zinc-200 text-sm"
          @click="cancelEditing"
        >
          {{ $t("cancel") }}
        </button>
      </div>

      <div class="flex flex-col gap-y-4 max-w-2xl">
        <!-- Display Name -->
        <div class="bg-zinc-800 p-4 rounded-xl flex flex-col gap-y-2">
          <label class="block text-sm font-medium leading-6 text-zinc-100">{{
            $t("library.admin.import.version.displayName")
          }}</label>
          <p class="text-zinc-400 text-xs">
            {{ $t("library.admin.import.version.displayNameDesc") }}
          </p>
          <input
            v-model="editForm.displayName"
            type="text"
            class="min-w-48 block w-full rounded-md bg-zinc-950 px-3 py-1.5 text-white outline-1 -outline-offset-1 outline-zinc-800 placeholder:text-zinc-500 focus:outline-1 focus:-outline-offset-1 focus:outline-blue-500 sm:text-sm/6"
            :placeholder="
              $t('library.admin.import.version.displayNamePlaceholder')
            "
          />
        </div>

        <!-- Setup configurations -->
        <div class="bg-zinc-800 p-4 rounded-xl flex flex-col gap-y-2">
          <label class="block text-sm font-medium leading-6 text-zinc-100">{{
            $t("library.admin.import.version.setupCmd")
          }}</label>
          <p class="text-zinc-400 text-xs">
            {{ $t("library.admin.import.version.setupDesc") }}
          </p>
          <ol
            v-if="editForm.setups.length > 0"
            class="divide-y-1 divide-zinc-700"
          >
            <li
              v-for="(setup, setupIdx) in editForm.setups"
              :key="setupIdx"
              class="py-2 inline-flex items-start gap-x-1 w-full"
            >
              <ImportVersionLaunchRow
                v-model="editForm.setups[setupIdx]"
                :version-guesses="[]"
                :needs-name="false"
              />
              <button
                class="transition rounded p-1 bg-zinc-900/30 group hover:bg-red-600/30"
                @click="() => editForm.setups.splice(setupIdx, 1)"
              >
                <TrashIcon
                  class="transition size-5 text-zinc-700 group-hover:text-red-700"
                />
              </button>
            </li>
          </ol>
          <span
            v-else
            class="text-sm text-zinc-700 uppercase font-display font-bold"
          >
            {{ $t("library.admin.import.version.noSetups") }}
          </span>
          <LoadingButton
            :loading="false"
            class="w-fit"
            @click="
              () =>
                editForm.setups.push({
                  platform: undefined as any,
                  launch: '',
                })
            "
          >
            {{ $t("common.add") }}
          </LoadingButton>
        </div>

        <!-- Setup-only mode -->
        <SwitchGroup
          as="div"
          class="bg-zinc-800 p-4 rounded-xl flex items-center justify-between gap-4"
        >
          <span class="flex flex-grow flex-col">
            <SwitchLabel
              as="span"
              class="text-sm font-medium leading-6 text-zinc-100"
              passive
            >
              {{ $t("library.admin.import.version.setupMode") }}
            </SwitchLabel>
            <SwitchDescription as="span" class="text-sm text-zinc-400">
              {{ $t("library.admin.import.version.setupModeDesc") }}
            </SwitchDescription>
          </span>
          <Switch
            v-model="editForm.onlySetup"
            :class="[
              editForm.onlySetup ? 'bg-blue-600' : 'bg-zinc-900',
              'relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-600 focus:ring-offset-2',
            ]"
          >
            <span
              aria-hidden="true"
              :class="[
                editForm.onlySetup ? 'translate-x-5' : 'translate-x-0',
                'pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out',
              ]"
            />
          </Switch>
        </SwitchGroup>

        <!-- Launch configurations -->
        <div class="relative flex flex-col gap-y-2 bg-zinc-800 p-4 rounded-xl">
          <label class="block text-sm font-medium leading-6 text-zinc-100">{{
            $t("library.admin.import.version.launchCmd")
          }}</label>
          <p class="text-zinc-400 text-xs">
            {{ $t("library.admin.import.version.launchDesc") }}
          </p>
          <ol
            v-if="editForm.launches.length > 0"
            class="divide-y-1 divide-zinc-700"
          >
            <li
              v-for="(launch, launchIdx) in editForm.launches"
              :key="launchIdx"
              class="py-2 inline-flex items-start gap-x-1 w-full"
            >
              <Disclosure
                v-slot="{ open }"
                :default-open="true"
                as="div"
                class="py-2 px-3 w-full bg-zinc-900 rounded-lg"
              >
                <dt>
                  <DisclosureButton
                    class="flex w-full items-center text-left text-white"
                  >
                    <span v-if="launch.name" class="text-sm font-semibold">
                      {{ launch.name }}
                    </span>
                    <span v-else class="text-sm text-zinc-500 italic">
                      {{ $t("library.admin.import.version.noNameProvided") }}
                    </span>
                    <span class="ml-auto flex h-7 items-center">
                      <PlusIcon
                        v-if="!open"
                        class="size-6"
                        aria-hidden="true"
                      />
                      <MinusIcon v-else class="size-6" aria-hidden="true" />
                    </span>
                    <button
                      class="ml-1 transition rounded p-1 bg-zinc-900/30 group hover:bg-red-600/30"
                      @click.prevent="
                        () => editForm.launches.splice(launchIdx, 1)
                      "
                    >
                      <TrashIcon
                        class="transition size-5 text-zinc-700 group-hover:text-red-700"
                      />
                    </button>
                  </DisclosureButton>
                </dt>
                <DisclosurePanel as="dd" class="mt-2">
                  <ImportVersionLaunchRow
                    v-model="editForm.launches[launchIdx]"
                    :version-guesses="[]"
                    :needs-name="true"
                    :allow-emulator="true"
                    :type="game.type"
                  />
                </DisclosurePanel>
              </Disclosure>
            </li>
          </ol>
          <span
            v-else
            class="text-sm text-zinc-700 uppercase font-display font-bold"
          >
            {{ $t("library.admin.import.version.noLaunches") }}
          </span>
          <LoadingButton
            :loading="false"
            class="w-fit"
            @click="
              () =>
                editForm.launches.push({
                  platform: undefined as any,
                  launch: '',
                  name: '',
                })
            "
          >
            {{ $t("common.add") }}
          </LoadingButton>

          <div
            v-if="editForm.onlySetup"
            class="absolute inset-0 bg-zinc-900/50 rounded-xl"
          />
        </div>

        <!-- Delta / Update mode -->
        <SwitchGroup
          as="div"
          class="bg-zinc-800 p-4 rounded-xl flex items-center gap-4 justify-between"
        >
          <span class="flex flex-grow flex-col">
            <SwitchLabel
              as="span"
              class="text-sm font-medium leading-6 text-zinc-100"
              passive
            >
              {{ $t("library.admin.import.version.updateMode") }}
            </SwitchLabel>
            <SwitchDescription as="span" class="text-sm text-zinc-400">
              {{ $t("library.admin.import.version.updateModeDesc") }}
            </SwitchDescription>
          </span>
          <Switch
            v-model="editForm.delta"
            :class="[
              editForm.delta ? 'bg-blue-600' : 'bg-zinc-900',
              'relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-600 focus:ring-offset-2',
            ]"
          >
            <span
              aria-hidden="true"
              :class="[
                editForm.delta ? 'translate-x-5' : 'translate-x-0',
                'pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out',
              ]"
            />
          </Switch>
        </SwitchGroup>

        <!-- Save / Cancel buttons -->
        <div class="flex items-center gap-x-3 justify-end">
          <button
            class="rounded-md px-3 py-1.5 text-sm font-semibold text-zinc-300 hover:text-white"
            @click="cancelEditing"
          >
            {{ $t("cancel") }}
          </button>
          <LoadingButton :loading="editSaving" @click="saveEditing">
            {{ $t("common.save") }}
          </LoadingButton>
        </div>

        <div v-if="editError" class="mt-2 w-fit rounded-md bg-red-600/10 p-4">
          <div class="flex">
            <div class="flex-shrink-0">
              <XCircleIcon class="h-5 w-5 text-red-600" aria-hidden="true" />
            </div>
            <div class="ml-3">
              <h3 class="text-sm font-medium text-red-600">
                {{ editError }}
              </h3>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
  <div v-else class="grow w-full flex items-center justify-center">
    <div class="flex flex-col items-center">
      <ExclamationCircleIcon
        class="h-12 w-12 text-red-600"
        aria-hidden="true"
      />
      <div class="mt-3 text-center sm:mt-5">
        <h1 class="text-3xl font-semibold font-display leading-6 text-zinc-100">
          {{ $t("library.admin.offlineTitle") }}
        </h1>
        <div class="mt-4">
          <p class="text-sm text-zinc-400 max-w-md">
            {{ $t("library.admin.offline") }}
          </p>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { SerializeObject } from "nitropack";
import type { H3Error } from "h3";
import {
  Switch,
  SwitchDescription,
  SwitchGroup,
  SwitchLabel,
  Disclosure,
  DisclosureButton,
  DisclosurePanel,
} from "@headlessui/vue";
import { ExclamationCircleIcon, Bars3Icon } from "@heroicons/vue/24/outline";
import { TrashIcon, MinusIcon, PlusIcon } from "@heroicons/vue/20/solid";
import { XCircleIcon } from "@heroicons/vue/16/solid";
import { FetchError } from "ofetch";
import type { AdminFetchGameType } from "~/server/api/v1/admin/game/[id]/index.get";
import type { Platform } from "~/prisma/client/enums";

const props = defineProps<{ unimportedVersions: string[] }>();

const { t } = useI18n();

const hasDeleted = ref(false);

const canImport = computed(
  () => hasDeleted.value || props.unimportedVersions.length > 0,
);

const game = defineModel<SerializeObject<AdminFetchGameType>>({
  required: true,
});
if (!game.value)
  throw createError({
    statusCode: 500,
    statusMessage: "Game not provided to editor component",
  });

type VersionType = (typeof game.value.versions)[number];

// ── Edit state ──────────────────────────────────────────────────────
const editingVersionId = ref<string | null>(null);
const editSaving = ref(false);
const editError = ref<string | undefined>();

interface EditLaunchForm {
  name: string;
  launch: string;
  platform: Platform;
  emulatorId?: string;
  suggestions?: string[];
  discPaths?: string[];
  umuIdOverride?: string;
  umuStoreOverride?: string;
}

interface EditSetupForm {
  launch: string;
  platform: Platform;
}

const editForm = ref<{
  displayName: string;
  onlySetup: boolean;
  delta: boolean;
  launches: EditLaunchForm[];
  setups: EditSetupForm[];
}>({
  displayName: "",
  onlySetup: false,
  delta: false,
  launches: [],
  setups: [],
});

function startEditing(version: VersionType) {
  editingVersionId.value = version.versionId;
  editError.value = undefined;

  // Populate form from current version data
  editForm.value = {
    displayName: version.displayName ?? "",
    onlySetup: version.onlySetup,
    delta: version.delta,
    setups: version.setups.map((s) => ({
      launch: s.command,
      platform: s.platform,
    })),
    launches: version.launches.map((l) => ({
      name: l.name,
      launch: l.command,
      platform: l.platform,
      emulatorId: l.emulator?.launchId ?? undefined,
      suggestions: l.emulatorSuggestions ?? [],
      discPaths: l.discPaths ?? [],
      umuIdOverride: l.umuIdOverride ?? undefined,
      umuStoreOverride: l.umuStoreOverride ?? undefined,
    })),
  };
}

function cancelEditing() {
  editingVersionId.value = null;
  editError.value = undefined;
}

async function saveEditing() {
  if (!editingVersionId.value) return;
  editSaving.value = true;
  editError.value = undefined;

  const versionId = editingVersionId.value;
  const gameId = game.value.id;

  try {
    // 1. Update metadata
    await $fetch(`/api/v1/admin/game/${gameId}/versions/${versionId}`, {
      method: "PUT",
      body: {
        displayName: editForm.value.displayName || undefined,
        onlySetup: editForm.value.onlySetup,
        delta: editForm.value.delta,
      },
    });

    // 2. Update setups
    await $fetch(`/api/v1/admin/game/${gameId}/versions/${versionId}/setups`, {
      method: "PUT",
      body: {
        setups: editForm.value.setups
          .filter((s) => s.platform && s.launch)
          .map((s) => ({
            platform: s.platform,
            command: s.launch,
          })),
      },
    });

    // 3. Update launches
    await $fetch(
      `/api/v1/admin/game/${gameId}/versions/${versionId}/launches`,
      {
        method: "PUT",
        body: {
          launches: editForm.value.launches
            .filter((l) => l.platform && l.launch)
            .map((l) => ({
              platform: l.platform,
              name: l.name || "Default",
              command: l.launch,
              emulatorId: l.emulatorId || undefined,
              suggestions: l.suggestions ?? [],
              discPaths: l.discPaths ?? [],
              umuIdOverride: l.umuIdOverride || undefined,
              umuStoreOverride: l.umuStoreOverride || undefined,
            })),
        },
      },
    );

    editingVersionId.value = null;

    // Reload the full game data to ensure everything is in sync
    const { game: freshGame } = await $dropFetch("/api/v1/admin/game/:id", {
      params: { id: gameId },
    });
    game.value = freshGame;
  } catch (error) {
    if (error instanceof FetchError) {
      editError.value =
        error.data?.statusMessage ?? error.data?.message ?? t("errors.unknown");
    } else {
      editError.value = (error as Error)?.message ?? t("errors.unknown");
    }
  } finally {
    editSaving.value = false;
  }
}

// ── Existing functions ──────────────────────────────────────────────
async function updateVersionOrder() {
  try {
    const newVersionOrder = await $dropFetch(
      "/api/v1/admin/game/:id/versions",
      {
        method: "PATCH",
        body: {
          versions: game.value.versions.map((e) => e.versionId),
        },
        params: {
          id: game.value.id,
        },
      },
    );
    const newVersions = newVersionOrder.map(
      (id) => game.value.versions.find((k) => k.versionId == id)!,
    );
    game.value.versions = newVersions;
  } catch (e) {
    createModal(
      ModalType.Notification,
      {
        title: t("errors.version.order.title"),
        description: t("errors.version.order.desc", {
          error: (e as H3Error)?.statusMessage ?? t("errors.unknown"),
        }),
        buttonText: t("common.close"),
      },
      (e, c) => c(),
    );
  }
}

async function deleteVersion(versionId: string) {
  try {
    await $dropFetch("/api/v1/admin/game/:id/versions", {
      method: "DELETE",
      body: {
        version: versionId,
      },
      params: {
        id: game.value.id,
      },
    });
    game.value.versions.splice(
      game.value.versions.findIndex((e) => e.versionId === versionId),
      1,
    );
    hasDeleted.value = true;

    // Close edit panel if we deleted the version being edited
    if (editingVersionId.value === versionId) {
      editingVersionId.value = null;
    }
  } catch (e) {
    createModal(
      ModalType.Notification,
      {
        title: t("errors.version.delete.title"),
        description: t("errors.version.delete.desc", {
          error: (e as H3Error)?.statusMessage ?? t("errors.unknown"),
        }),
        buttonText: t("common.close"),
      },
      (e, c) => c(),
    );
  }
}
</script>
