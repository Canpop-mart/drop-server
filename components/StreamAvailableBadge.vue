<template>
  <div
    v-if="activeSession"
    class="inline-flex items-center gap-2 rounded-md bg-purple-600/20 border border-purple-500/30 px-3 py-2 text-sm text-purple-200"
  >
    <span class="size-2 rounded-full bg-purple-400 animate-pulse" />
    <span>
      Streaming from
      <strong class="text-purple-100">{{
        activeSession.hostClient.name
      }}</strong>
    </span>
    <span class="text-purple-400">&middot;</span>
    <span class="text-purple-300 text-xs">
      Connect via Moonlight to
      {{ activeSession.hostLocalIp ?? "your local network" }}
    </span>
  </div>
</template>

<script setup lang="ts">
const props = defineProps<{
  gameId: string;
}>();

interface StreamSession {
  id: string;
  status: string;
  hostClient: { id: string; name: string; platform: string };
  game: { id: string; mName: string; mIconObjectId: string } | null;
  sunshinePort: number;
  hostLocalIp: string | null;
  hostExternalIp: string | null;
  hasPairingPin: boolean;
  createdAt: string;
  lastHeartbeat: string;
}

const activeSession = ref<StreamSession | null>(null);

onMounted(async () => {
  try {
    const sessions = await $dropFetch<StreamSession[]>(
      "/api/v1/client/streaming/sessions",
    );
    activeSession.value =
      sessions?.find(
        (s: StreamSession) =>
          s.game?.id === props.gameId &&
          (s.status === "Ready" || s.status === "Streaming"),
      ) ?? null;
  } catch {
    // Streaming not available — silently ignore
  }
});
</script>
