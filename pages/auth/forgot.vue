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
            {{
              submitted
                ? $t("auth.forgot.successTitle")
                : $t("auth.forgot.title")
            }}
          </h2>
          <p class="mt-2 text-sm leading-6 text-zinc-400">
            {{
              submitted
                ? $t("auth.forgot.genericResponse")
                : $t("auth.forgot.subtitle")
            }}
          </p>
        </div>

        <div class="mt-10">
          <!-- Success state: the response is identical whether or not the
               account exists, so we never reveal registration status. -->
          <div v-if="submitted" class="rounded-md bg-green-600/10 p-4">
            <div class="flex">
              <div class="flex-shrink-0">
                <CheckCircleIcon
                  class="h-5 w-5 text-green-500"
                  aria-hidden="true"
                />
              </div>
              <div class="ml-3">
                <p class="text-sm font-medium text-green-400">
                  {{ $t("auth.forgot.genericResponse") }}
                </p>
              </div>
            </div>
          </div>

          <form v-else class="space-y-6" @submit.prevent="submit">
            <div>
              <label
                for="email"
                class="block text-sm font-medium leading-6 text-zinc-300"
                >{{ $t("auth.forgot.emailLabel") }}</label
              >
              <div class="mt-2">
                <input
                  id="email"
                  v-model="email"
                  name="email"
                  type="email"
                  autocomplete="email"
                  required
                  class="block w-full rounded-md border-0 py-1.5 px-3 shadow-sm bg-zinc-950/20 text-zinc-300 ring-1 ring-inset ring-zinc-800 placeholder:text-zinc-400 focus:ring-2 focus:ring-inset focus:ring-blue-600 sm:text-sm sm:leading-6"
                />
              </div>
            </div>

            <div>
              <LoadingButton class="w-full" :loading="loading">{{
                $t("auth.forgot.submit")
              }}</LoadingButton>
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

          <div class="mt-6 text-sm leading-6">
            <NuxtLink
              to="/auth/signin"
              class="font-semibold text-blue-600 hover:text-blue-500"
            >
              <i18n-t keypath="auth.forgot.backToSignin" tag="span" scope="global">
                <template #arrow>
                  <span aria-hidden="true">{{ $t("chars.arrow") }}</span>
                </template>
              </i18n-t>
            </NuxtLink>
          </div>
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
import { FetchError } from "ofetch";

const { t } = useI18n();

const email = ref("");
const loading = ref(false);
const submitted = ref(false);
const error = ref<string | undefined>(undefined);

async function submit() {
  loading.value = true;
  error.value = undefined;
  try {
    await $dropFetch("/api/v1/auth/password/forgot", {
      method: "POST",
      body: { email: email.value },
    });
    // The endpoint always returns 200 regardless of whether the account
    // exists, so success here just means "the request was accepted".
    submitted.value = true;
  } catch (e) {
    if (e instanceof FetchError) {
      error.value = e.data?.message || t("errors.unknown");
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
  title: t("auth.forgot.title"),
});
</script>
