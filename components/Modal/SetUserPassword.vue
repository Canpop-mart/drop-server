<template>
  <ModalTemplate :model-value="!!user" size-class="max-w-xl">
    <template #default>
      <div>
        <DialogTitle
          as="h3"
          class="text-lg font-bold font-display text-zinc-100"
        >
          {{ $t("users.admin.setPassword.title", [user?.username]) }}
        </DialogTitle>
        <p class="mt-1 text-sm text-zinc-400">
          {{ $t("users.admin.setPassword.description") }}
        </p>
      </div>

      <form
        v-if="!success"
        class="mt-4 space-y-4"
        @submit.prevent="() => submit()"
      >
        <div>
          <label
            for="set-password"
            class="block text-sm font-medium text-zinc-100 mb-1"
            >{{ $t("users.admin.setPassword.passwordLabel") }}</label
          >
          <p
            :class="[
              validPassword ? 'text-blue-400' : 'text-red-500',
              'block text-xs font-medium leading-5 mb-1',
            ]"
          >
            {{ $t("users.admin.setPassword.passwordFormat") }}
          </p>
          <input
            id="set-password"
            v-model="password"
            type="password"
            autocomplete="new-password"
            class="block w-full rounded-md border-0 py-1.5 px-3 bg-zinc-800 text-zinc-100 shadow-sm ring-1 ring-inset ring-zinc-700 placeholder:text-zinc-400 focus:ring-2 focus:ring-inset focus:ring-blue-600 sm:text-sm sm:leading-6"
          />
        </div>
        <div>
          <label
            for="set-password-confirm"
            class="block text-sm font-medium text-zinc-100 mb-1"
            >{{ $t("users.admin.setPassword.confirmLabel") }}</label
          >
          <p
            v-if="confirmPassword.length > 0 && !passwordsMatch"
            class="block text-xs font-medium leading-5 mb-1 text-red-500"
          >
            {{ $t("users.admin.setPassword.confirmMismatch") }}
          </p>
          <input
            id="set-password-confirm"
            v-model="confirmPassword"
            type="password"
            autocomplete="new-password"
            class="block w-full rounded-md border-0 py-1.5 px-3 bg-zinc-800 text-zinc-100 shadow-sm ring-1 ring-inset ring-zinc-700 placeholder:text-zinc-400 focus:ring-2 focus:ring-inset focus:ring-blue-600 sm:text-sm sm:leading-6"
          />
        </div>
        <button class="hidden" type="submit" />
      </form>

      <div v-if="success" class="mt-4 rounded-md bg-green-600/10 p-3">
        <p class="text-sm font-medium text-green-400">
          {{ $t("users.admin.setPassword.success") }}
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
        {{ $t("users.admin.setPassword.submitButton") }}
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
import { type } from "arktype";
import { FetchError } from "ofetch";
import type { UserModel } from "~/prisma/client/models";

const user = defineModel<UserModel | undefined>();
const { t } = useI18n();

const password = ref("");
const confirmPassword = ref("");
const loading = ref(false);
const error = ref<string | undefined>(undefined);
const success = ref(false);

// Mirrors the 8-char minimum enforced server-side / at signup.
const passwordValidator = type("string >= 8");
const validPassword = computed(
  () =>
    !((passwordValidator(password.value) as unknown) instanceof type.errors),
);
const passwordsMatch = computed(() => password.value === confirmPassword.value);
const canSubmit = computed(
  () => validPassword.value && passwordsMatch.value && !loading.value,
);

// Reset transient state whenever the modal opens/closes for a different user.
watch(user, () => {
  password.value = "";
  confirmPassword.value = "";
  loading.value = false;
  error.value = undefined;
  success.value = false;
});

async function submit() {
  if (!user.value || !canSubmit.value) return;
  loading.value = true;
  error.value = undefined;
  try {
    await $dropFetch(`/api/v1/admin/users/${user.value.id}/password/set`, {
      method: "POST",
      body: { password: password.value },
    });
    success.value = true;
    password.value = "";
    confirmPassword.value = "";
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
