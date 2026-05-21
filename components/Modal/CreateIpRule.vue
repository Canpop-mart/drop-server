<template>
  <ModalTemplate v-model="open" size-class="max-w-xl">
    <template #default>
      <div>
        <DialogTitle as="h3" class="text-lg font-medium leading-6 text-white">
          Add IP rule
        </DialogTitle>
        <p class="mt-1 text-zinc-400 text-sm">
          Allow rules take precedence: if any Allow rule exists, only matching
          IPs are admitted. Deny rules block matching IPs otherwise.
        </p>
      </div>

      <div class="mt-4 space-y-4">
        <!-- Kind -->
        <div>
          <label class="block text-sm font-medium leading-6 text-zinc-100">
            Rule type
          </label>
          <div class="mt-2 flex gap-2">
            <button
              type="button"
              :class="[
                kind === 'Allow'
                  ? 'bg-green-500/20 text-green-300 ring-green-500/40'
                  : 'bg-zinc-800 text-zinc-400 ring-zinc-700 hover:bg-zinc-700',
                'flex-1 rounded-md px-3 py-2 text-sm font-medium ring-1 ring-inset transition-colors',
              ]"
              @click="kind = 'Allow'"
            >
              Allow
            </button>
            <button
              type="button"
              :class="[
                kind === 'Deny'
                  ? 'bg-red-500/20 text-red-300 ring-red-500/40'
                  : 'bg-zinc-800 text-zinc-400 ring-zinc-700 hover:bg-zinc-700',
                'flex-1 rounded-md px-3 py-2 text-sm font-medium ring-1 ring-inset transition-colors',
              ]"
              @click="kind = 'Deny'"
            >
              Deny
            </button>
          </div>
        </div>

        <!-- Pattern -->
        <div>
          <label
            for="ip-pattern"
            class="block text-sm font-medium leading-6 text-zinc-100"
          >
            IP address or CIDR range
          </label>
          <p class="text-zinc-400 block text-xs leading-6">
            Exact address (192.168.1.5, 2001:db8::1) or CIDR (10.0.0.0/8,
            2001:db8::/32).
          </p>
          <input
            id="ip-pattern"
            v-model="pattern"
            type="text"
            placeholder="192.168.1.0/24"
            class="mt-1 block w-full rounded-md border-0 bg-zinc-800 py-1.5 px-3 font-mono text-white shadow-sm ring-1 ring-inset ring-zinc-700 placeholder:text-zinc-500 focus:ring-2 focus:ring-inset focus:ring-blue-600 sm:text-sm"
          />
        </div>

        <!-- Notes -->
        <div>
          <label
            for="ip-notes"
            class="block text-sm font-medium leading-6 text-zinc-100"
          >
            Notes
            <span class="text-zinc-500 font-normal">(optional)</span>
          </label>
          <input
            id="ip-notes"
            v-model="notes"
            type="text"
            placeholder="Office VPN"
            class="mt-1 block w-full rounded-md border-0 bg-zinc-800 py-1.5 px-3 text-white shadow-sm ring-1 ring-inset ring-zinc-700 placeholder:text-zinc-500 focus:ring-2 focus:ring-inset focus:ring-blue-600 sm:text-sm"
          />
        </div>

        <!-- Lockout error -->
        <div
          v-if="lockoutError"
          class="rounded-md bg-red-500/10 p-3 ring-1 ring-inset ring-red-500/20"
        >
          <div class="flex">
            <ExclamationTriangleIcon
              class="size-5 shrink-0 text-red-400"
              aria-hidden="true"
            />
            <div class="ml-3">
              <p class="text-sm font-medium text-red-300">
                {{ lockoutError }}
              </p>
              <button
                type="button"
                class="mt-2 inline-flex items-center rounded-md bg-green-500/15 px-2 py-1 text-xs font-medium text-green-300 ring-1 ring-inset ring-green-500/30 hover:bg-green-500/25"
                @click="addAllowForMyIp"
              >
                Add allow rule for my IP first ({{ currentIp }})
              </button>
            </div>
          </div>
        </div>

        <!-- Generic error -->
        <p v-if="genericError" class="text-sm text-red-400">
          {{ genericError }}
        </p>
      </div>
    </template>

    <template #buttons>
      <LoadingButton
        :loading="loading"
        :disabled="!pattern.trim()"
        class="w-full sm:w-fit"
        @click="() => submit()"
      >
        {{ $t("common.create") }}
      </LoadingButton>
      <button
        type="button"
        class="mt-3 inline-flex w-full justify-center rounded-md bg-zinc-800 px-3 py-2 text-sm font-semibold text-zinc-100 shadow-sm ring-1 ring-inset ring-zinc-800 hover:bg-zinc-900 sm:mt-0 sm:w-auto"
        @click="() => (open = false)"
      >
        {{ $t("cancel") }}
      </button>
    </template>
  </ModalTemplate>
</template>

<script setup lang="ts">
import { DialogTitle } from "@headlessui/vue";
import { ExclamationTriangleIcon } from "@heroicons/vue/24/outline";
import type { FetchError } from "ofetch";
import type { SerializedIpRule } from "~/server/internal/security/types";

const open = defineModel<boolean>({ required: true });

const props = defineProps<{
  /** The admin's current IP, shown in the lockout-recovery suggestion. */
  currentIp: string;
}>();

const emit = defineEmits<{
  created: [rule: SerializedIpRule];
}>();

const kind = ref<"Allow" | "Deny">("Deny");
const pattern = ref("");
const notes = ref("");
const loading = ref(false);

// A 409 from the lockout guard is shown inline rather than as a toast, so
// the admin can immediately act on the "add an Allow rule first" advice.
const lockoutError = ref<string | null>(null);
const genericError = ref<string | null>(null);

function reset() {
  kind.value = "Deny";
  pattern.value = "";
  notes.value = "";
  lockoutError.value = null;
  genericError.value = null;
}

// Prefill the modal with an Allow rule for the admin's own IP so they can
// unblock themselves with a single click after a lockout rejection.
function addAllowForMyIp() {
  kind.value = "Allow";
  pattern.value = props.currentIp;
  notes.value = "My IP";
  lockoutError.value = null;
  genericError.value = null;
}

async function submit() {
  if (!pattern.value.trim() || loading.value) return;
  loading.value = true;
  lockoutError.value = null;
  genericError.value = null;

  try {
    const rule = await $dropFetch("/api/v1/admin/security/ip-rules", {
      method: "POST",
      body: {
        kind: kind.value,
        pattern: pattern.value.trim(),
        notes: notes.value.trim() || undefined,
      },
    });
    emit("created", rule);
    open.value = false;
    reset();
  } catch (e) {
    const err = e as FetchError;
    const status = err?.statusCode ?? err?.response?.status;
    const data = err?.data as { error?: string; message?: string } | undefined;
    if (status === 409) {
      lockoutError.value =
        data?.error ??
        "Saving this rule would lock you out. Add an Allow rule for your IP first.";
    } else {
      genericError.value =
        data?.error ??
        data?.message ??
        "Failed to create the IP rule. Check the pattern and try again.";
    }
  } finally {
    loading.value = false;
  }
}

watch(open, (isOpen) => {
  if (!isOpen) reset();
});
</script>
