<template>
  <ModalTemplate :model-value="!!user" size-class="max-w-xl">
    <template #default>
      <div>
        <DialogTitle
          as="h3"
          class="text-lg font-bold font-display text-zinc-100"
        >
          {{ $t("users.admin.resetLink.title", [user?.username]) }}
        </DialogTitle>
        <p class="mt-1 text-sm text-zinc-400">
          {{ $t("users.admin.resetLink.description") }}
        </p>
      </div>

      <!-- Before generation: explain + confirm -->
      <div v-if="!result && !error" class="mt-4">
        <p class="text-sm text-zinc-400">
          {{ $t("users.admin.resetLink.hint") }}
        </p>
      </div>

      <!-- After generation: show the copyable URL -->
      <div v-if="result" class="mt-4 space-y-3">
        <div>
          <label
            for="reset-link-url"
            class="block text-sm font-medium text-zinc-100 mb-1"
            >{{ $t("users.admin.resetLink.urlLabel") }}</label
          >
          <div class="flex gap-x-2">
            <input
              id="reset-link-url"
              :value="result.url"
              type="text"
              readonly
              class="block w-full rounded-md border-0 py-1.5 px-3 bg-zinc-800 text-zinc-100 shadow-sm ring-1 ring-inset ring-zinc-700 focus:ring-2 focus:ring-inset focus:ring-blue-600 sm:text-sm sm:leading-6"
              @focus="(e) => (e.target as HTMLInputElement).select()"
            />
            <button
              type="button"
              class="inline-flex shrink-0 items-center rounded-md bg-blue-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-500"
              @click="() => copyUrl()"
            >
              {{
                copied
                  ? $t("users.admin.resetLink.copied")
                  : $t("users.admin.resetLink.copy")
              }}
            </button>
          </div>
        </div>
        <p class="text-sm font-medium text-amber-400">
          {{ $t("users.admin.resetLink.singleUseWarning") }}
        </p>
      </div>

      <div v-if="error" class="mt-4 rounded-md bg-red-600/10 p-3">
        <p class="text-sm font-medium text-red-500">{{ error }}</p>
      </div>
    </template>
    <template #buttons>
      <LoadingButton
        v-if="!result"
        :loading="loading"
        class="bg-blue-600 text-white hover:bg-blue-500"
        @click="() => generate()"
      >
        {{ $t("users.admin.resetLink.generateButton") }}
      </LoadingButton>
      <button
        class="inline-flex items-center rounded-md bg-zinc-800 px-3 py-2 text-sm font-semibold font-display text-white hover:bg-zinc-700"
        @click="() => close()"
      >
        {{ result ? $t("common.close") : $t("cancel") }}
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

const loading = ref(false);
const error = ref<string | undefined>(undefined);
const result = ref<{ url: string; expiresAt: string } | undefined>(undefined);
const copied = ref(false);

// Reset transient state whenever the modal opens/closes for a different user.
watch(user, () => {
  loading.value = false;
  error.value = undefined;
  result.value = undefined;
  copied.value = false;
});

async function generate() {
  if (!user.value) return;
  loading.value = true;
  error.value = undefined;
  try {
    result.value = await $dropFetch(
      `/api/v1/admin/users/${user.value.id}/password/reset-link`,
      { method: "POST" },
    );
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

async function copyUrl() {
  if (!result.value) return;
  try {
    await navigator.clipboard.writeText(result.value.url);
    copied.value = true;
    setTimeout(() => (copied.value = false), 2000);
  } catch {
    /* clipboard unavailable — user can still select the field manually */
  }
}

function close() {
  user.value = undefined;
}
</script>
