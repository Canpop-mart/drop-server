<template>
  <div class="flex">
    <a
      :href="`/auth/oidc?redirect=${encodeURIComponent(redirectTarget)}`"
      class="transition rounded-md grow inline-flex items-center justify-center bg-white/10 px-3.5 py-2.5 text-sm font-semibold text-white shadow-xs hover:bg-white/20"
    >
      <i18n-t
        keypath="auth.signin.signinWithExternalProvider"
        tag="span"
        scope="global"
      >
        <template #externalProvider>{{
          providerName || $t("auth.signin.externalProvider")
        }}</template>
        <template #arrow>
          <span aria-hidden="true">{{ $t("chars.arrow") }}</span>
        </template>
      </i18n-t>
    </a>
  </div>
</template>

<script setup lang="ts">
const route = useRoute();

// Only forward a same-origin relative path; anything else (cross-origin, protocol-
// relative, or scheme) collapses to "/" so the post-login redirect can't be hijacked.
const redirectTarget = computed(() => {
  const raw = route.query.redirect;
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (
    typeof value !== "string" ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.startsWith("/\\")
  )
    return "/";
  return value;
});

const { providerName = undefined } = defineProps<{ providerName?: string }>();
</script>
