<template>
  <div>
    <div class="flex gap-1 flex-wrap">
      <span
        v-for="extension in model"
        :key="extension"
        class="inline-flex items-center gap-x-0.5 rounded-md bg-blue-400/10 px-2 py-1 text-xs font-medium text-blue-400 inset-ring inset-ring-blue-400/30"
      >
        {{ extension }}
        <button
          type="button"
          class="group relative -mr-1 size-3.5 rounded-xs hover:bg-blue-500/30"
          @click="() => removeFileExtension(extension)"
        >
          <span class="sr-only">{{ $t("common.remove") }}</span>
          <svg
            viewBox="0 0 14 14"
            class="size-3.5 stroke-blue-400 group-hover:stroke-blue-300"
          >
            <path d="M4 4l6 6m0-6l-6 6" />
          </svg>
          <span class="absolute -inset-1"></span>
        </button>
      </span>
      <span v-if="model.length == 0" class="text-zinc-500 text-xs">{{
        $t("library.admin.fileExtSelector.noSelected")
      }}</span>
    </div>
    <div class="mt-2 flex gap-x-2 items-center">
      <div
        class="flex w-full rounded-md shadow-sm bg-zinc-800 ring-1 ring-inset ring-zinc-700 focus-within:ring-2 focus-within:ring-inset focus-within:ring-blue-600"
      >
        <input
          v-model="inputValue"
          type="text"
          class="block flex-1 border-0 py-1.5 pl-2 bg-transparent text-zinc-100 placeholder:text-zinc-400 focus:ring-0 sm:text-sm sm:leading-6 w-full"
          :placeholder="$t('library.admin.fileExtSelector.placeholder')"
          @keydown.enter.prevent="addFromInput"
        />
      </div>
      <button
        type="button"
        class="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white shadow-sm hover:bg-blue-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 whitespace-nowrap"
        @click="addFromInput"
      >
        {{ $t("common.add") }}
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
const model = defineModel<string[]>({ required: true });

const inputValue = ref("");

function normalize(v: string) {
  const k = v.toLowerCase().replaceAll(/[^a-zA-Z0-9]*/g, "");
  if (!k) return "";
  if (k.startsWith(".")) return k;
  return `.${k}`;
}

function addFromInput() {
  const raw = inputValue.value.trim();
  if (!raw) return;

  // Split on commas, spaces, or semicolons to allow batch input
  const parts = raw.split(/[,;\s]+/).filter(Boolean);
  for (const part of parts) {
    const value = normalize(part);
    if (value && !model.value.includes(value)) {
      model.value.push(value);
    }
  }
  inputValue.value = "";
}

function removeFileExtension(extension: string) {
  const index = model.value.findIndex((v) => v === extension);
  if (index == -1) return;
  model.value.splice(index, 1);
}
</script>
