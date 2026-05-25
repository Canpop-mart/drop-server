<template>
  <ModalTemplate :model-value="!!user" size-class="max-w-xl">
    <template #default>
      <div>
        <DialogTitle
          as="h3"
          class="text-lg font-bold font-display text-zinc-100"
        >
          {{ $t("users.admin.setCloudQuota.title", [user?.username]) }}
        </DialogTitle>
        <p class="mt-1 text-sm text-zinc-400">
          {{ $t("users.admin.setCloudQuota.description") }}
        </p>
      </div>

      <form
        v-if="!success"
        class="mt-4 space-y-4"
        @submit.prevent="() => submit()"
      >
        <div>
          <label
            for="set-cloud-quota"
            class="block text-sm font-medium text-zinc-100 mb-1"
          >
            {{ $t("users.admin.setCloudQuota.quotaLabel") }}
          </label>
          <p class="text-xs text-zinc-500 mb-1">
            {{
              $t("users.admin.setCloudQuota.currentUsage", [
                formatBytes(currentBytes),
              ])
            }}
          </p>
          <div class="flex items-center gap-2">
            <input
              id="set-cloud-quota"
              v-model.number="quotaMib"
              type="number"
              min="0"
              max="1048576"
              step="1"
              class="block w-full rounded-md border-0 py-1.5 px-3 bg-zinc-800 text-zinc-100 shadow-sm ring-1 ring-inset ring-zinc-700 placeholder:text-zinc-400 focus:ring-2 focus:ring-inset focus:ring-blue-600 sm:text-sm sm:leading-6"
            />
            <span class="text-sm font-display text-zinc-400">MiB</span>
          </div>
          <p
            v-if="!validQuota"
            class="block text-xs font-medium leading-5 mt-1 text-red-500"
          >
            {{ $t("users.admin.setCloudQuota.invalidRange") }}
          </p>
          <div class="mt-3 flex flex-wrap gap-1.5">
            <button
              v-for="preset in presets"
              :key="preset.mib"
              type="button"
              class="rounded-md bg-zinc-800 px-2 py-1 text-xs font-medium text-zinc-300 ring-1 ring-zinc-700 hover:bg-zinc-700"
              @click="quotaMib = preset.mib"
            >
              {{ preset.label }}
            </button>
          </div>
        </div>
        <button class="hidden" type="submit" />
      </form>

      <div v-if="success" class="mt-4 rounded-md bg-green-600/10 p-3">
        <p class="text-sm font-medium text-green-400">
          {{
            $t("users.admin.setCloudQuota.success", [formatBytes(savedBytes)])
          }}
        </p>
      </div>

      <div v-if="error" class="mt-4 rounded-md bg-red-600/10 p-3">
        <p class="text-sm font-medium text-red-500">{{ error }}</p>
      </div>
    </template>
    <template #buttons>
      <LoadingButton
        v-if="!success"
        :loading="loading"
        :disabled="!canSubmit"
        class="bg-blue-600 text-white hover:bg-blue-500"
        @click="() => submit()"
      >
        {{ $t("users.admin.setCloudQuota.submitButton") }}
      </LoadingButton>
      <button
        class="inline-flex items-center rounded-md bg-zinc-800 px-3 py-2 text-sm font-semibold font-display text-white hover:bg-zinc-700"
        @click="() => close()"
      >
        {{ success ? $t("common.close") : $t("cancel") }}
      </button>
    </template>
  </ModalTemplate>
</template>

<script setup lang="ts">
import { DialogTitle } from "@headlessui/vue";
import { FetchError } from "ofetch";
import type { UserModel } from "~/prisma/client/models";

const user = defineModel<UserModel | undefined>();
const { t } = useI18n();

// Modal sources the initial value from the user model itself; the admin
// users list (/admin/users) hydrates `cloudSaveQuotaBytes` for every row
// when /api/v1/admin/users returns the full User select.
const MIB = 1024 * 1024;
const DEFAULT_MIB = 1024; // 1 GiB
const MAX_MIB = 1024 * 1024; // 1 TiB ceiling — enough for any realistic case

const quotaMib = ref<number>(DEFAULT_MIB);
const currentBytes = ref<number>(0);
const loading = ref(false);
const error = ref<string | undefined>(undefined);
const success = ref(false);
const savedBytes = ref<number>(0);

const presets = [
  { mib: 256, label: "256 MiB" },
  { mib: 1024, label: "1 GiB" },
  { mib: 5120, label: "5 GiB" },
  { mib: 10240, label: "10 GiB" },
];

const validQuota = computed(() => {
  const v = quotaMib.value;
  return Number.isFinite(v) && v >= 0 && v <= MAX_MIB;
});
const canSubmit = computed(() => validQuota.value && !loading.value);

// Reset transient state whenever the modal opens/closes for a different user.
// `cloudSaveQuotaBytes` on the user row may be a BigInt (Prisma) or a number
// (JSON wire format) depending on where the parent loaded it from — accept
// both. Same for the type guard below.
watch(user, (next) => {
  loading.value = false;
  error.value = undefined;
  success.value = false;
  savedBytes.value = 0;
  if (!next) return;
  const raw = (next as unknown as { cloudSaveQuotaBytes?: number | bigint })
    .cloudSaveQuotaBytes;
  const bytes = typeof raw === "bigint" ? Number(raw) : (raw ?? 0);
  currentBytes.value = bytes;
  quotaMib.value = bytes > 0 ? Math.round(bytes / MIB) : DEFAULT_MIB;
});

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

async function submit() {
  if (!user.value || !canSubmit.value) return;
  loading.value = true;
  error.value = undefined;
  try {
    const bytes = Math.round(quotaMib.value * MIB);
    const res = await $dropFetch<{ cloudSaveQuotaBytes: number }>(
      `/api/v1/admin/users/${user.value.id}/quota`,
      { method: "POST", body: { bytes } },
    );
    savedBytes.value = res.cloudSaveQuotaBytes;
    success.value = true;
  } catch (e) {
    if (e instanceof FetchError) {
      error.value = e.data?.message || e.statusMessage || t("errors.unknown");
    } else {
      error.value = t("errors.unknown");
    }
  } finally {
    loading.value = false;
  }
}

function close() {
  user.value = undefined;
}
</script>
