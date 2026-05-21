<template>
  <div class="w-full">
    <div class="w-full flex justify-between items-start">
      <div>
        <h2
          class="mt-2 text-xl font-semibold tracking-tight text-zinc-100 sm:text-3xl"
        >
          IP access control
        </h2>
        <p
          class="mt-2 text-pretty text-sm font-medium text-zinc-400 sm:text-md/8"
        >
          Restrict which IP addresses can reach this server. If any Allow rule
          exists, only matching addresses are admitted; otherwise every address
          is admitted unless it matches a Deny rule. Localhost and health checks
          are always allowed.
        </p>
      </div>
      <div class="shrink-0">
        <LoadingButton :loading="false" @click="() => (createOpen = true)">
          Add rule
        </LoadingButton>
      </div>
    </div>

    <!-- Current IP banner -->
    <div
      class="mt-4 inline-flex items-center gap-x-2 rounded-md bg-zinc-800/60 px-3 py-2 text-sm text-zinc-300 ring-1 ring-inset ring-zinc-700"
    >
      <GlobeAltIcon class="size-4 text-blue-400" aria-hidden="true" />
      <span>Your current IP:</span>
      <span class="font-mono text-zinc-100">{{ currentIp }}</span>
    </div>

    <!-- Allow rules -->
    <SecuritySection
      title="Allow rules"
      :description="
        allowRules.length > 0
          ? 'Default-deny is active — only addresses matching an enabled Allow rule can reach the server.'
          : 'No Allow rules. Add one to switch the server into default-deny mode.'
      "
      :rules="allowRules"
      kind="Allow"
      @toggle="toggleRule"
      @delete="deleteRule"
    />

    <!-- Deny rules -->
    <SecuritySection
      title="Deny rules"
      description="Addresses matching an enabled Deny rule are blocked (ignored while an Allow rule is active)."
      :rules="denyRules"
      kind="Deny"
      class="mt-8"
      @toggle="toggleRule"
      @delete="deleteRule"
    />

    <ModalCreateIpRule
      v-model="createOpen"
      :current-ip="currentIp"
      @created="onRuleCreated"
    />
  </div>
</template>

<script setup lang="ts">
import { GlobeAltIcon } from "@heroicons/vue/24/outline";

definePageMeta({
  layout: "admin",
});

// The endpoint returns the admin's own IP plus every rule (newest first),
// each with its creating user joined in.
const data = ref(await $dropFetch("/api/v1/admin/security/ip-rules"));

type IpRule = (typeof data.value.rules)[number];

const currentIp = computed(() => data.value.currentIp);
const allowRules = computed(() =>
  data.value.rules.filter((r) => r.kind === "Allow"),
);
const denyRules = computed(() =>
  data.value.rules.filter((r) => r.kind === "Deny"),
);

const createOpen = ref(false);

function onRuleCreated(rule: IpRule) {
  // Newest first — matches the server's ordering.
  data.value.rules.unshift(rule);
}

async function toggleRule(rule: IpRule) {
  try {
    // `failTitle` surfaces any error as a toast — including the 409 the
    // lockout guard raises when disabling the rule would fence the admin
    // out (its statusMessage becomes the toast description).
    const updated = await $dropFetch("/api/v1/admin/security/ip-rules/:id", {
      method: "PATCH",
      params: { id: rule.id },
      body: { enabled: !rule.enabled },
      failTitle: "Could not update the IP rule.",
    });
    const index = data.value.rules.findIndex((r) => r.id === rule.id);
    if (index !== -1) data.value.rules[index] = updated;
  } catch {
    /* surfaced by failTitle */
  }
}

async function deleteRule(rule: IpRule) {
  try {
    await $dropFetch("/api/v1/admin/security/ip-rules/:id", {
      method: "DELETE",
      params: { id: rule.id },
      failTitle: "Failed to delete the IP rule.",
    });
    data.value.rules = data.value.rules.filter((r) => r.id !== rule.id);
  } catch {
    /* surfaced by failTitle */
  }
}
</script>
