<template>
  <NuxtLink
    v-if="game || defaultPlaceholder"
    :href="href"
    :class="{
      'transition-all duration-300 text-left hover:-translate-y-1 hover:shadow-xl hover:shadow-black/40':
        animate,
    }"
    class="group relative flex-1 min-w-42 max-w-48 h-64 rounded-xl overflow-hidden ring-1 ring-white/5 hover:ring-blue-500/40 hover:shadow-blue-500/10"
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

    <!-- Always-present subtle bottom gradient -->
    <div
      class="absolute inset-0 bg-gradient-to-t from-zinc-950/70 via-transparent to-transparent"
    />

    <!-- Hover info overlay: slides up on hover -->
    <div
      v-if="showTitleDescription"
      :class="{
        'translate-y-0 opacity-100': true,
      }"
      class="absolute bottom-0 left-0 right-0 p-3 transition-all duration-300"
    >
      <h1
        :class="{
          'group-hover:text-white transition-colors duration-200': animate,
        }"
        class="text-zinc-100 text-sm font-bold font-display leading-tight"
      >
        {{
          game ? game.mName : $t("settings.admin.store.dropGameNamePlaceholder")
        }}
      </h1>
      <p
        :class="{
          'max-h-0 opacity-0 group-hover:max-h-10 group-hover:opacity-100 transition-all duration-300':
            animate,
        }"
        class="text-zinc-400 text-xs line-clamp-2 mt-0.5 overflow-hidden"
      >
        {{
          game
            ? game.mShortDescription
            : $t("settings.admin.store.dropGameDescriptionPlaceholder")
        }}
      </p>
    </div>

    <!-- Blue glow accent on hover -->
    <div
      v-if="animate"
      class="absolute inset-0 rounded-xl ring-1 ring-inset ring-blue-400/0 group-hover:ring-blue-400/30 transition-all duration-300 pointer-events-none"
    />
  </NuxtLink>
  <SkeletonCard
    v-else-if="defaultPlaceholder === false"
    :message="$t('store.noGame')"
  />
</template>

<script setup lang="ts">
import type { SerializeObject } from "nitropack";

const { t } = useI18n();
const {
  game,
  href = undefined,
  showTitleDescription = true,
  animate = true,
  defaultPlaceholder = false,
} = defineProps<{
  game:
    | SerializeObject<{
        id: string;
        mCoverObjectId: string;
        mName: string;
        mShortDescription: string;
      }>
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
</script>

<style scoped>
img.active {
  view-transition-name: selected-game;
  contain: layout;
}
</style>
