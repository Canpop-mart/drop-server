<template>
  <div class="flex min-h-screen flex-1 bg-zinc-900">
    <div
      class="flex flex-1 flex-col justify-center px-4 py-12 sm:px-6 lg:flex-none lg:px-20 xl:px-24"
    >
      <div class="mx-auto w-full max-w-sm lg:w-96">
        <div>
          <ApplicationLogo class="h-10 w-auto" />
          <h2
            class="mt-8 text-2xl font-bold font-display leading-9 tracking-tight text-zinc-100"
          >
            {{ heading }}
          </h2>
          <p class="mt-2 text-sm leading-6 text-zinc-400">
            {{ subheading }}
          </p>
        </div>

        <div class="mt-10">
          <!-- Checking the token on mount -->
          <div
            v-if="state === 'checking'"
            class="flex items-center gap-x-3 text-sm text-zinc-400"
          >
            <span
              class="h-4 w-4 animate-spin rounded-full border-2 border-zinc-600 border-t-blue-500"
            />
            {{ $t("auth.reset.checking") }}
          </div>

          <!-- Invalid / expired link -->
          <div v-else-if="state === 'expired'">
            <div class="rounded-md bg-red-600/10 p-4">
              <div class="flex">
                <div class="flex-shrink-0">
                  <XCircleIcon
                    class="h-5 w-5 text-red-600"
                    aria-hidden="true"
                  />
                </div>
                <div class="ml-3">
                  <p class="text-sm font-medium text-red-500">
                    {{ $t("auth.reset.expiredDescription") }}
                  </p>
                </div>
              </div>
            </div>
            <div class="mt-6 flex gap-x-4 text-sm leading-6">
              <NuxtLink
                to="/auth/forgot"
                class="font-semibold text-blue-600 hover:text-blue-500"
                >{{ $t("auth.reset.requestNew") }}</NuxtLink
              >
            </div>
          </div>

          <!-- Success -->
          <div v-else-if="state === 'success'">
            <div class="rounded-md bg-green-600/10 p-4">
              <div class="flex">
                <div class="flex-shrink-0">
                  <CheckCircleIcon
                    class="h-5 w-5 text-green-500"
                    aria-hidden="true"
                  />
                </div>
                <div class="ml-3">
                  <p class="text-sm font-medium text-green-400">
                    {{ $t("auth.reset.successDescription") }}
                  </p>
                </div>
              </div>
            </div>
            <div class="mt-6 text-sm leading-6">
              <NuxtLink
                to="/auth/signin"
                class="font-semibold text-blue-600 hover:text-blue-500"
                >{{ $t("auth.reset.goToSignin") }}</NuxtLink
              >
            </div>
          </div>

          <!-- Reset form -->
          <form v-else class="space-y-6" @submit.prevent="submit">
            <div>
              <label
                for="password"
                class="block text-sm font-medium leading-6 text-zinc-300"
                >{{ $t("auth.reset.newPasswordLabel") }}</label
              >
              <p
                :class="[
                  validPassword ? 'text-blue-400' : 'text-red-500',
                  'block text-xs font-medium leading-6',
                ]"
              >
                {{ $t("auth.reset.passwordFormat") }}
              </p>
              <div class="mt-1">
                <input
                  id="password"
                  v-model="password"
                  name="password"
                  type="password"
                  autocomplete="new-password"
                  required
                  class="block w-full rounded-md border-0 py-1.5 px-3 shadow-sm bg-zinc-950/20 text-zinc-300 ring-1 ring-inset ring-zinc-800 placeholder:text-zinc-400 focus:ring-2 focus:ring-inset focus:ring-blue-600 sm:text-sm sm:leading-6"
                />
              </div>
            </div>

            <div>
              <label
                for="confirm-password"
                class="block text-sm font-medium leading-6 text-zinc-300"
                >{{ $t("auth.reset.confirmLabel") }}</label
              >
              <p
                v-if="confirmPassword.length > 0 && !passwordsMatch"
                class="block text-xs font-medium leading-6 text-red-500"
              >
                {{ $t("auth.reset.confirmMismatch") }}
              </p>
              <div class="mt-1">
                <input
                  id="confirm-password"
                  v-model="confirmPassword"
                  name="confirm-password"
                  type="password"
                  autocomplete="new-password"
                  required
                  class="block w-full rounded-md border-0 py-1.5 px-3 shadow-sm bg-zinc-950/20 text-zinc-300 ring-1 ring-inset ring-zinc-800 placeholder:text-zinc-400 focus:ring-2 focus:ring-inset focus:ring-blue-600 sm:text-sm sm:leading-6"
                />
              </div>
            </div>

            <div>
              <LoadingButton
                class="w-full"
                :loading="loading"
                :disabled="!canSubmit"
                >{{ $t("auth.reset.submit") }}</LoadingButton
              >
            </div>

            <div v-if="error" class="mt-1 rounded-md bg-red-600/10 p-4">
              <div class="flex">
                <div class="flex-shrink-0">
                  <XCircleIcon
                    class="h-5 w-5 text-red-600"
                    aria-hidden="true"
                  />
                </div>
                <div class="ml-3">
                  <h3 class="text-sm font-medium text-red-600">
                    {{ error }}
                  </h3>
                </div>
              </div>
            </div>
          </form>
        </div>
      </div>
    </div>
    <div class="relative hidden w-0 flex-1 lg:block">
      <img
        src="/wallpapers/signin.jpg"
        class="absolute inset-0 h-full w-full object-cover"
        alt=""
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { XCircleIcon, CheckCircleIcon } from "@heroicons/vue/20/solid";
import { type } from "arktype";
import { FetchError } from "ofetch";

const { t } = useI18n();
const route = useRoute();

const token = route.params.token?.toString() ?? "";

type ResetState = "checking" | "expired" | "form" | "success";
const state = ref<ResetState>("checking");

const password = ref("");
const confirmPassword = ref("");
const loading = ref(false);
const error = ref<string | undefined>(undefined);

const passwordValidator = type("string >= 8");
const validPassword = computed(
  () => !((passwordValidator(password.value) as unknown) instanceof type.errors),
);
const passwordsMatch = computed(
  () => password.value === confirmPassword.value,
);
const canSubmit = computed(
  () => validPassword.value && passwordsMatch.value && !loading.value,
);

const heading = computed(() => {
  switch (state.value) {
    case "expired":
      return t("auth.reset.expiredTitle");
    case "success":
      return t("auth.reset.successTitle");
    default:
      return t("auth.reset.title");
  }
});
const subheading = computed(() => {
  switch (state.value) {
    case "expired":
      return t("auth.reset.expiredDescription");
    case "success":
      return t("auth.reset.successDescription");
    case "checking":
      return t("auth.reset.checking");
    default:
      return t("auth.reset.subtitle");
  }
});

// Validate the token on mount so the page can show an "expired link" state
// before the user fills anything in.
onMounted(async () => {
  if (!token) {
    state.value = "expired";
    return;
  }
  try {
    const { valid } = await $dropFetch(
      `/api/v1/auth/password/reset/${encodeURIComponent(token)}/validate`,
    );
    state.value = valid ? "form" : "expired";
  } catch {
    state.value = "expired";
  }
});

async function submit() {
  if (!canSubmit.value) return;
  loading.value = true;
  error.value = undefined;
  try {
    await $dropFetch("/api/v1/auth/password/reset", {
      method: "POST",
      body: { token, password: password.value },
    });
    state.value = "success";
  } catch (e) {
    if (e instanceof FetchError) {
      error.value = e.data?.message || t("errors.unknown");
      // A 400 here means the token expired/was consumed between mount and
      // submit — switch to the expired state so the user gets a fresh link.
      if (e.statusCode === 400) state.value = "expired";
    } else {
      error.value = t("errors.unknown");
    }
  } finally {
    loading.value = false;
  }
}

definePageMeta({
  layout: false,
});

useHead({
  title: t("auth.reset.title"),
});
</script>
