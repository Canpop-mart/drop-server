<template>
  <div class="px-4 sm:px-6 lg:px-8 py-8">
    <div class="sm:flex sm:items-center">
      <div class="sm:flex-auto">
        <h1 class="text-base font-semibold text-white">Cloud Save Paths</h1>
        <p class="mt-2 text-sm text-gray-300">
          Configure which files and directories should be backed up to the cloud
          for this game. Use placeholders like
          <code class="text-blue-400">&lt;winAppData&gt;</code>,
          <code class="text-blue-400">&lt;home&gt;</code>,
          <code class="text-blue-400">&lt;xdgData&gt;</code>, etc.
        </p>
      </div>
      <div class="mt-4 sm:mt-0 sm:ml-16 sm:flex-none flex gap-2">
        <button
          type="button"
          class="inline-flex items-center gap-x-2 rounded-md bg-blue-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
          @click="addFile"
        >
          <PlusIcon class="size-4" /> Add Path
        </button>
        <button
          type="button"
          :disabled="saving"
          class="inline-flex items-center gap-x-2 rounded-md bg-green-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-green-500 disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green-600"
          @click="save"
        >
          <CloudArrowUpIcon class="size-4" />
          {{ saving ? "Saving..." : "Save" }}
        </button>
      </div>
    </div>

    <div
      v-if="statusMessage"
      class="mt-4 rounded-md p-3 text-sm"
      :class="
        statusError
          ? 'bg-red-900/50 text-red-300'
          : 'bg-green-900/50 text-green-300'
      "
    >
      {{ statusMessage }}
    </div>

    <div v-if="loading" class="mt-8 text-zinc-400 text-sm">Loading...</div>

    <div v-else-if="files.length === 0" class="mt-8">
      <p class="text-zinc-400 text-sm">
        No save paths configured. Click "Add Path" to get started.
      </p>
    </div>

    <div v-else class="mt-6 space-y-4">
      <div
        v-for="(file, index) in files"
        :key="index"
        class="rounded-lg bg-zinc-800 border border-zinc-700 p-4"
      >
        <div class="flex items-start justify-between gap-4">
          <div class="flex-1 space-y-3">
            <div>
              <label class="block text-xs font-medium text-zinc-400 mb-1"
                >Path</label
              >
              <input
                v-model="file.path"
                type="text"
                placeholder="e.g. <winAppData>/Vampire Survivors/saves"
                class="block w-full rounded-md bg-zinc-900 px-3 py-1.5 text-sm text-zinc-100 outline outline-1 -outline-offset-1 outline-zinc-700 placeholder:text-zinc-500 focus:outline focus:outline-2 focus:-outline-offset-2 focus:outline-blue-600"
              />
            </div>

            <div class="grid grid-cols-2 gap-3">
              <div>
                <label class="block text-xs font-medium text-zinc-400 mb-1"
                  >Type</label
                >
                <select
                  v-model="file.dataType"
                  class="block w-full rounded-md bg-zinc-900 px-3 py-1.5 text-sm text-zinc-100 outline outline-1 -outline-offset-1 outline-zinc-700 focus:outline focus:outline-2 focus:-outline-offset-2 focus:outline-blue-600"
                >
                  <option value="file">File / Directory</option>
                  <option value="registry">Registry</option>
                  <option value="other">Other</option>
                </select>
              </div>

              <div>
                <label class="block text-xs font-medium text-zinc-400 mb-1"
                  >Tag</label
                >
                <select
                  v-model="file.tag"
                  class="block w-full rounded-md bg-zinc-900 px-3 py-1.5 text-sm text-zinc-100 outline outline-1 -outline-offset-1 outline-zinc-700 focus:outline focus:outline-2 focus:-outline-offset-2 focus:outline-blue-600"
                >
                  <option value="save">Save</option>
                  <option value="config">Config</option>
                  <option value="other">Other</option>
                </select>
              </div>
            </div>

            <div>
              <label class="block text-xs font-medium text-zinc-400 mb-1"
                >Platform</label
              >
              <div class="flex gap-3">
                <label
                  v-for="os in platforms"
                  :key="os"
                  class="inline-flex items-center gap-1.5 text-sm text-zinc-300"
                >
                  <input
                    type="checkbox"
                    :checked="file.platforms.includes(os)"
                    class="rounded border-zinc-600 bg-zinc-900 text-blue-600 focus:ring-blue-600"
                    @change="togglePlatform(file, os)"
                  />
                  {{ os }}
                </label>
              </div>
            </div>
          </div>

          <button
            type="button"
            class="text-zinc-500 hover:text-red-400 mt-1"
            @click="removeFile(index)"
          >
            <TrashIcon class="size-5" />
          </button>
        </div>
      </div>
    </div>

    <div class="mt-8 rounded-lg bg-zinc-800/50 border border-zinc-700/50 p-4">
      <h3 class="text-sm font-medium text-zinc-300 mb-2">
        Available Placeholders
      </h3>
      <div class="grid grid-cols-2 lg:grid-cols-3 gap-x-4 gap-y-1 text-xs">
        <div v-for="p in placeholders" :key="p.key" class="text-zinc-400">
          <code class="text-blue-400">{{ p.key }}</code>
          <span class="text-zinc-500 ml-1">{{ p.desc }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import {
  PlusIcon,
  TrashIcon,
  CloudArrowUpIcon,
} from "@heroicons/vue/24/outline";

const props = defineProps<{
  modelValue: { id: string };
}>();

interface SaveFileEntry {
  path: string;
  dataType: string;
  tag: string;
  platforms: string[];
}

const platforms = ["Windows", "Linux", "macOS"];

const placeholders = [
  { key: "<home>", desc: "User home dir" },
  { key: "<base>", desc: "<root>/<game>" },
  { key: "<root>", desc: "Games install dir" },
  { key: "<game>", desc: "Game install dir name" },
  { key: "<winAppData>", desc: "%APPDATA%" },
  { key: "<winLocalAppData>", desc: "%LOCALAPPDATA%" },
  { key: "<winLocalAppDataLow>", desc: "AppData/LocalLow" },
  { key: "<winDocuments>", desc: "Documents folder" },
  { key: "<winPublic>", desc: "%PUBLIC%" },
  { key: "<winProgramData>", desc: "%PROGRAMDATA%" },
  { key: "<winDir>", desc: "%WINDIR%" },
  { key: "<xdgData>", desc: "$XDG_DATA_HOME" },
  { key: "<xdgConfig>", desc: "$XDG_CONFIG_HOME" },
  { key: "<storeUserId>", desc: "Store user ID" },
  { key: "<osUserName>", desc: "OS username" },
];

const files = ref<SaveFileEntry[]>([]);
const loading = ref(true);
const saving = ref(false);
const statusMessage = ref("");
const statusError = ref(false);

function addFile() {
  files.value.push({
    path: "",
    dataType: "file",
    tag: "save",
    platforms: ["Windows"],
  });
}

function removeFile(index: number) {
  files.value.splice(index, 1);
}

function togglePlatform(file: SaveFileEntry, os: string) {
  const idx = file.platforms.indexOf(os);
  if (idx >= 0) {
    file.platforms.splice(idx, 1);
  } else {
    file.platforms.push(os);
  }
}

// Convert server JSON to our editable format
function fromServerFormat(data: {
  files: Array<{
    path: string;
    dataType?: string;
    data_type?: string;
    tags?: string[];
    conditions?: Array<{ type: string; value?: string }>;
  }>;
}): SaveFileEntry[] {
  return data.files.map((f) => ({
    path: f.path,
    dataType: f.dataType || f.data_type || "file",
    tag: f.tags?.[0] || "save",
    platforms:
      f.conditions
        ?.filter((c) => c.type === "os")
        .map((c) => {
          if (c.value === "windows") return "Windows";
          if (c.value === "linux") return "Linux";
          if (c.value === "macos") return "macOS";
          return c.value || "";
        })
        .filter(Boolean) || [],
  }));
}

// Convert our editable format to server JSON
function toServerFormat(entries: SaveFileEntry[]) {
  return {
    files: entries
      .filter((f) => f.path.trim())
      .map((f) => ({
        path: f.path,
        dataType: f.dataType,
        tags: [f.tag],
        conditions: f.platforms.map((os) => ({
          type: "os",
          value: os.toLowerCase(),
        })),
      })),
  };
}

// Load existing save paths
onMounted(async () => {
  try {
    const data = await $dropFetch(`/api/v1/admin/game/:id/save-paths`, {
      params: { id: props.modelValue.id },
    });
    if (data && typeof data === "object" && "files" in (data as object)) {
      files.value = fromServerFormat(
        data as Parameters<typeof fromServerFormat>[0],
      );
    }
  } catch {
    // No save paths yet — that's fine
  } finally {
    loading.value = false;
  }
});

async function save() {
  saving.value = true;
  statusMessage.value = "";
  try {
    const payload = toServerFormat(files.value);
    await $dropFetch(`/api/v1/admin/game/:id/save-paths`, {
      params: { id: props.modelValue.id },
      method: "PATCH",
      body: payload,
    });
    statusMessage.value = "Save paths updated successfully.";
    statusError.value = false;
  } catch (e) {
    statusMessage.value = `Failed to save: ${e}`;
    statusError.value = true;
  } finally {
    saving.value = false;
  }
}
</script>
                                               