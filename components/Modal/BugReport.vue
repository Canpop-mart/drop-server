<template>
  <TransitionRoot as="template" :show="open">
    <Dialog class="relative z-50" @close="open = false">
      <TransitionChild
        as="template"
        enter="ease-out duration-200"
        enter-from="opacity-0"
        enter-to="opacity-100"
        leave="ease-in duration-150"
        leave-from="opacity-100"
        leave-to="opacity-0"
      >
        <div class="fixed inset-0 bg-zinc-950/80 backdrop-blur-sm" />
      </TransitionChild>
      <div class="fixed inset-0 z-10 overflow-y-auto">
        <div class="flex min-h-full items-center justify-center p-4">
          <TransitionChild
            as="template"
            enter="ease-out duration-200"
            enter-from="opacity-0 scale-95"
            enter-to="opacity-100 scale-100"
            leave="ease-in duration-150"
            leave-from="opacity-100 scale-100"
            leave-to="opacity-0 scale-95"
          >
            <DialogPanel
              class="w-full max-w-lg rounded-xl bg-zinc-900 p-6 shadow-xl ring-1 ring-white/10"
            >
              <DialogTitle
                class="text-lg font-bold font-display text-zinc-100 mb-1"
              >
                {{ $t("bugReport.title") }}
              </DialogTitle>
              <p class="text-sm text-zinc-400 mb-5">
                {{ $t("bugReport.subtitle") }}
              </p>

              <div class="space-y-4">
                <!-- Title -->
                <div>
                  <label class="block text-sm font-medium text-zinc-300 mb-1">
                    {{ $t("bugReport.form.title") }}
                    <span class="text-red-400">*</span>
                  </label>
                  <input
                    v-model="reportTitle"
                    type="text"
                    maxlength="200"
                    class="w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/50"
                    :placeholder="$t('bugReport.form.titlePlaceholder')"
                  />
                </div>

                <!-- Description -->
                <div>
                  <label class="block text-sm font-medium text-zinc-300 mb-1">
                    {{ $t("bugReport.form.description") }}
                  </label>
                  <textarea
                    v-model="reportDescription"
                    maxlength="2000"
                    rows="4"
                    class="w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/50 resize-none"
                    :placeholder="$t('bugReport.form.descriptionPlaceholder')"
                  />
                </div>

                <!-- Screenshot -->
                <div>
                  <label class="block text-sm font-medium text-zinc-300 mb-1">
                    {{ $t("bugReport.form.screenshot") }}
                  </label>
                  <label
                    for="bug-screenshot-upload"
                    class="group cursor-pointer transition relative block w-full rounded-lg border-2 border-dashed border-zinc-700 p-4 text-center hover:border-zinc-600"
                  >
                    <PhotoIcon
                      v-if="!screenshotPreview"
                      class="mx-auto h-6 w-6 text-zinc-500 group-hover:text-zinc-400"
                    />
                    <img
                      v-else
                      :src="screenshotPreview"
                      class="mx-auto max-h-32 rounded-md"
                    />
                    <span
                      class="mt-1 block text-xs text-zinc-500 group-hover:text-zinc-400"
                    >
                      {{
                        screenshotFile
                          ? screenshotFile.name
                          : $t("bugReport.form.screenshotHint")
                      }}
                    </span>
                  </label>
                  <input
                    id="bug-screenshot-upload"
                    class="hidden"
                    type="file"
                    accept="image/*"
                    @change="onScreenshotSelect"
                  />
                </div>

                <!-- Auto-collected info hint -->
                <div
                  class="rounded-md bg-zinc-800/50 px-3 py-2 text-xs text-zinc-500"
                >
                  <InformationCircleIcon
                    class="inline h-3.5 w-3.5 mr-1 -mt-0.5"
                  />
                  {{ $t("bugReport.form.autoCollectHint") }}
                </div>
              </div>

              <!-- Error -->
              <div v-if="submitError" class="mt-3 rounded-md bg-red-600/10 p-3">
                <p class="text-sm text-red-400">{{ submitError }}</p>
              </div>

              <!-- Success -->
              <div v-if="submitted" class="mt-3 rounded-md bg-green-600/10 p-3">
                <p class="text-sm text-green-400">
                  {{ $t("bugReport.success") }}
                </p>
              </div>

              <div class="flex justify-end gap-2 mt-6">
                <button
                  class="px-4 py-2 rounded-md text-sm text-zinc-300 hover:text-zinc-100"
                  @click="open = false"
                >
                  {{ $t("cancel") }}
                </button>
                <LoadingButton
                  v-if="!submitted"
                  :loading="submitting"
                  :disabled="!reportTitle.trim()"
                  class="px-4 py-2 rounded-md text-sm font-medium bg-red-600 hover:bg-red-500 text-white disabled:opacity-50 disabled:cursor-not-allowed"
                  @click="submitReport"
                >
                  {{ $t("bugReport.form.submit") }}
                </LoadingButton>
              </div>
            </DialogPanel>
          </TransitionChild>
        </div>
      </div>
    </Dialog>
  </TransitionRoot>
</template>

<script setup lang="ts">
import {
  Dialog,
  DialogPanel,
  DialogTitle,
  TransitionChild,
  TransitionRoot,
} from "@headlessui/vue";
import { PhotoIcon, InformationCircleIcon } from "@heroicons/vue/24/outline";

const { t } = useI18n();

const open = defineModel<boolean>({ required: true });
const emit = defineEmits(["submitted"]);

const reportTitle = ref("");
const reportDescription = ref("");
const screenshotFile = ref<File | null>(null);
const screenshotPreview = ref<string | null>(null);
const submitting = ref(false);
const submitError = ref<string | undefined>();
const submitted = ref(false);

function onScreenshotSelect(e: Event) {
  const files = (e.target as HTMLInputElement)?.files;
  if (!files?.length) return;
  screenshotFile.value = files[0];

  // Generate preview
  const reader = new FileReader();
  reader.onload = () => {
    screenshotPreview.value = reader.result as string;
  };
  reader.readAsDataURL(files[0]);
}

function collectSystemInfo(): Record<string, unknown> {
  const info: Record<string, unknown> = {};

  // Browser / client info
  info.userAgent = navigator.userAgent;
  info.platform = navigator.platform;
  info.language = navigator.language;
  info.screenResolution = `${screen.width}x${screen.height}`;
  info.windowSize = `${window.innerWidth}x${window.innerHeight}`;
  info.colorDepth = screen.colorDepth;
  info.devicePixelRatio = window.devicePixelRatio;
  info.timestamp = new Date().toISOString();

  // Detect client vs web
  info.surface = navigator.userAgent.includes("Drop Desktop Client")
    ? "client"
    : "web";

  return info;
}

async function submitReport() {
  if (!reportTitle.value.trim()) return;
  submitting.value = true;
  submitError.value = undefined;

  try {
    const systemInfo = collectSystemInfo();

    if (screenshotFile.value) {
      // Multipart upload with screenshot
      const form = new FormData();
      form.append("title", reportTitle.value.trim());
      form.append("description", reportDescription.value.trim());
      form.append("systemInfo", JSON.stringify(systemInfo));
      form.append("screenshot", screenshotFile.value);

      await $dropFetch("/api/v1/bugreports/create", {
        method: "POST",
        body: form,
      });
    } else {
      // JSON body (no screenshot)
      await $dropFetch("/api/v1/bugreports/create", {
        method: "POST",
        body: {
          title: reportTitle.value.trim(),
          description: reportDescription.value.trim(),
          systemInfo: JSON.stringify(systemInfo),
        },
      });
    }

    submitted.value = true;
    emit("submitted");

    // Auto-close after a moment
    setTimeout(() => {
      open.value = false;
      // Reset form
      reportTitle.value = "";
      reportDescription.value = "";
      screenshotFile.value = null;
      screenshotPreview.value = null;
      submitted.value = false;
    }, 1500);
  } catch (error: unknown) {
    const err = error as { statusMessage?: string };
    submitError.value = err.statusMessage ?? t("errors.unknown");
  } finally {
    submitting.value = false;
  }
}
</script>
