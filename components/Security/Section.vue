<template>
  <div>
    <h3 class="text-base font-semibold text-zinc-100">
      {{ title }}
    </h3>
    <p class="mt-1 text-sm text-zinc-400">
      {{ description }}
    </p>

    <div
      class="mt-3 overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900 shadow-sm"
    >
      <div class="overflow-x-auto">
        <table class="min-w-full divide-y divide-zinc-800">
          <thead>
            <tr class="bg-zinc-800/50">
              <th
                scope="col"
                class="py-3 pl-4 pr-3 text-left text-xs font-semibold uppercase tracking-wide text-zinc-400 sm:pl-6"
              >
                Pattern
              </th>
              <th
                scope="col"
                class="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wide text-zinc-400"
              >
                Notes
              </th>
              <th
                scope="col"
                class="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wide text-zinc-400"
              >
                Enabled
              </th>
              <th
                scope="col"
                class="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wide text-zinc-400"
              >
                Added by
              </th>
              <th
                scope="col"
                class="px-3 py-3 text-left text-xs font-semibold uppercase tracking-wide text-zinc-400"
              >
                Added
              </th>
              <th scope="col" class="relative py-3 pl-3 pr-4 sm:pr-6">
                <span class="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody class="divide-y divide-zinc-800">
            <tr
              v-for="rule in rules"
              :key="rule.id"
              class="transition-colors duration-150 hover:bg-zinc-800/50"
            >
              <td
                class="whitespace-nowrap py-3 pl-4 pr-3 text-sm sm:pl-6"
                :class="
                  rule.enabled
                    ? 'font-mono text-zinc-100'
                    : 'font-mono text-zinc-500 line-through'
                "
              >
                {{ rule.pattern }}
              </td>
              <td class="px-3 py-3 text-sm text-zinc-400">
                {{ rule.notes || "—" }}
              </td>
              <td class="whitespace-nowrap px-3 py-3 text-sm">
                <button
                  type="button"
                  role="switch"
                  :aria-checked="rule.enabled"
                  :class="[
                    rule.enabled ? 'bg-blue-600' : 'bg-zinc-700',
                    'relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500',
                  ]"
                  @click="emit('toggle', rule)"
                >
                  <span class="sr-only">Toggle rule {{ rule.pattern }}</span>
                  <span
                    :class="[
                      rule.enabled ? 'translate-x-4' : 'translate-x-0.5',
                      'inline-block size-4 translate-y-0.5 transform rounded-full bg-white transition-transform duration-200',
                    ]"
                  />
                </button>
              </td>
              <td class="whitespace-nowrap px-3 py-3 text-sm text-zinc-400">
                {{
                  rule.createdByUser?.displayName ||
                  rule.createdByUser?.username ||
                  "Unknown"
                }}
              </td>
              <td class="whitespace-nowrap px-3 py-3 text-sm text-zinc-400">
                <RelativeTime :date="rule.createdAt" />
              </td>
              <td
                class="relative whitespace-nowrap py-3 pl-3 pr-4 text-right text-sm font-medium sm:pr-6"
              >
                <button
                  type="button"
                  class="inline-flex items-center rounded-md bg-red-400/10 px-2 py-1 text-xs font-medium text-red-400 ring-1 ring-inset ring-red-400/20 transition-all duration-200 hover:bg-red-400/20 hover:scale-105 active:scale-95"
                  @click="emit('delete', rule)"
                >
                  Delete
                  <span class="sr-only"> rule {{ rule.pattern }}</span>
                </button>
              </td>
            </tr>
            <tr v-if="rules.length === 0">
              <td colspan="6" class="py-8 text-center text-sm text-zinc-500">
                No {{ kind.toLowerCase() }} rules.
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts" generic="T extends SerializedIpRule">
import type { SerializedIpRule } from "~/server/internal/security/types";

/**
 * Generic over the concrete row type so the parent's inferred `$dropFetch`
 * type flows straight through the `toggle` / `delete` events without a cast.
 */
defineProps<{
  title: string;
  description: string;
  kind: "Allow" | "Deny";
  rules: T[];
}>();

const emit = defineEmits<{
  toggle: [rule: T];
  delete: [rule: T];
}>();
</script>
