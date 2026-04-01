<template>
  <NuxtLink
    v-if="game || defaultPlaceholder"
    :href="href"
    :class="{
      'transition-all duration-300 hover:-translate-y-1 hover:shadow-xl hover:shadow-black/40':
        animate,
    }"
    class="group relative flex-1 min-w-28 rounded-xl overflow-hidden ring-1 ring-white/5 hover:ring-blue-500/40 hover:shadow-blue-500/10 aspect-[2/3] bg-zinc-900 block"
  >
    <!-- Cover image -->
    <div
      :class="{
        'transition-transform duration-500 group-hover:scale-110': animate,
      }"
      class="absolute inset-0"
    >
      <img
        :src="imageProps.src"
        class="w-full h-full object-cover brightness-90"
        :alt="imageProps.alt"
      />
    </div>

    <!-- Dim overlay on hover (before eye button) -->
    <div
      v-if="animate"
      class="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-all duration-200 pointer-events-none"
    />

    <!-- Update available badge (always visible) -->
    <div
      v-if="game?.updateAvailable"
      class="absolute top-2 right-2 z-20 pointer-events-none"
    >
      <span
        class="text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-orange-500 text-white leading-tight shadow-lg"
      >
        {{ $t("store.updateAvailable") }}
      </span>
    </div>

    <!-- Top badges row (hover only) -->
    <div
      class="absolute top-2 left-2 right-2 flex items-start justify-between gap-1 z-10 opacity-0 group-hover:opacity-100 transition-opacity duration-200"
    >
      <!-- Genre tag badge (top-left) -->
      <span
        v-if="firstTag"
        class="text-[10px] font-semibold px-1.5 py-0.5 rounded-md bg-black/65 text-zinc-300 leading-tight max-w-[55%] truncate"
      >
        {{ firstTag }}
      </span>
      <span v-else class="shrink-0" />

      <!-- Version badge (top-right) -->
      <span
        v-if="versionLabel"
        class="text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-green-700 text-white leading-tight shrink-0 whitespace-nowrap"
      >
        {{ versionLabel }}
      </span>
    </div>

    <!-- Centered hover "eye" button -->
    <div
      v-if="animate"
      class="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-200 z-10 pointer-events-none"
    >
      <div
        class="w-11 h-11 rounded-full bg-blue-600 flex items-center justify-center shadow-lg shadow-blue-600/40"
      >
        <EyeIcon class="size-5 text-white" />
      </div>
    </div>

    <!-- Bottom info bar — slides up on hover -->
    <div
      v-if="showTitleDescription"
      class="absolute bottom-0 left-0 right-0 px-3 py-2.5 bg-zinc-950/90 border-t border-white/5 z-10 translate-y-full group-hover:translate-y-0 transition-transform duration-200"
    >
      <p class="text-zinc-100 text-xs font-bold leading-tight truncate">
        {{
          game ? game.mName : $t("settings.admin.store.dropGameNamePlaceholder")
        }}
      </p>
      <p v-if="metaLine" class="text-zinc-500 text-[10px] mt-0.5 truncate">
        {{ metaLine }}
      </p>
    </div>

    <!-- Blue glow ring on hover -->
    <div
      v-if="animate"
      class="absolute inset-0 rounded-xl ring-1 ring-inset ring-blue-400/0 group-hover:ring-blue-400/30 transition-all duration-300 pointer-events-none z-20"
    />
  </NuxtLink>

  <SkeletonCard
    v-else-if="defaultPlaceholder === false"
    :message="$t('store.noGame')"
  />
</template>

<script setup lang="ts">
import { EyeIcon } from "@heroicons/vue/24/solid";

const { t } = useI18n();
const {
  game,
  href = undefined,
  showTitleDescription = true,
  animate = true,
  defaultPlaceholder = false,
} = defineProps<{
  game:
    | {
        id: string;
        mCoverObjectId: string;
        mName: string;
        mShortDescription: string;
        mReleased?: string | null;
        updateAvailable?: boolean | null;
        tags?: Array<{ id: string; name: string }>;
        versions?: Array<{
          displayName?: string | null;
          versionIndex?: number;
        }>;
      }
    | undefined
    | null;
  href?: string;
  showTitleDescription?: boolean;
  animate?: boolean;
  defaultPlaceholder?: boolean;
}>();

const imageProps = {
  src: "",
  alt: t("settings.admin.store.dropGameAltPlaceholder"),
};

if (game) {
  imageProps.src = useObject(game.mCoverObjectId);
  imageProps.alt = game.mName;
} else if (defaultPlaceholder) {
  imageProps.src = "/game-panel-placeholder.png";
}

// Genre badge: first tag name
const firstTag = computed(() => game?.tags?.[0]?.name ?? null);

// Version badge: prefer displayName, fall back to "v{index}"
const versionLabel = computed(() => {
  const v = game?.versions?.[0];
  if (!v) return null;
  return v.displayName ?? `v${v.versionIndex}`;
});

// Meta line: release year
const metaLine = computed(() => {
  if (!game?.mReleased) return null;
  const year = new Date(game.mReleased).getFullYear();
  return isNaN(year) ? null : String(year);
});
</script>

<style scoped>
img.active {
  view-transition-name: selected-game;
  contain: layout;
}
</style>
