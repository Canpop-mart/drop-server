<template>
  <div class="max-w-6xl mx-auto">
    <!-- Banner -->
    <div class="relative h-48 rounded-t-xl overflow-hidden" v-if="profile?.bannerObjectId">
      <img :src="useObject(profile.bannerObjectId)" class="w-full h-full object-cover" />
      <div class="absolute inset-0 bg-gradient-to-t from-zinc-950/90 to-transparent" />
    </div>
    <div v-else class="h-32 bg-gradient-to-r from-blue-900/50 to-purple-900/50 rounded-t-xl" />
    <!-- Profile Header -->
    <div class="bg-zinc-900/50 rounded-b-xl p-6 -mt-16 relative">
      <div class="flex items-end gap-4">
        <img v-if="profile?.profilePictureObjectId" :src="useObject(profile.profilePictureObjectId)" class="w-28 h-28 rounded-full border-4 border-zinc-900 object-cover" />
        <div v-else class="w-28 h-28 rounded-full bg-zinc-700 border-4 border-zinc-900" />
        <div class="flex-1 pb-2">
          <h1 class="text-2xl font-bold font-display text-zinc-100">{{ profile?.displayName ?? profile?.username ?? "Unknown" }}</h1>
          <p class="text-zinc-400">@{{ profile?.username }}</p>
        </div>
        <NuxtLink v-if="isCurrentUser" to="/account" class="px-4 py-2 bg-zinc-800 rounded text-sm text-zinc-200 hover:bg-zinc-700">Edit Profile</NuxtLink>
      </div>
      <p v-if="profile?.bio" class="mt-4 text-zinc-300">{{ profile.bio }}</p>
    </div>
    <!-- Stats -->
    <div class="grid grid-cols-3 gap-4 my-6">
      <div class="p-4 bg-zinc-800/50 rounded-lg text-center">
        <p class="text-2xl font-bold text-blue-400">{{ userStats?.totalPlaytimeSeconds ? Math.round(userStats.totalPlaytimeSeconds/3600) : 0 }}h</p>
        <p class="text-sm text-zinc-400">Playtime</p>
      </div>
      <div class="p-4 bg-zinc-800/50 rounded-lg text-center">
        <p class="text-2xl font-bold text-blue-400">{{ userStats?.gamesPlayed ?? 0 }}</p>
        <p class="text-sm text-zinc-400">Games Played</p>
      </div>
      <div class="p-4 bg-zinc-800/50 rounded-lg text-center">
        <p class="text-2xl font-bold text-blue-400">{{ userStats?.achievementsUnlocked ?? 0 }}</p>
        <p class="text-sm text-zinc-400">Achievements</p>
      </div>
    </div>
    <!-- Activity -->
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div>
        <h2 class="text-lg font-bold font-display text-zinc-100 mb-3">Recent Activity</h2>
        <div v-if="activityLoading" class="text-zinc-500">Loading...</div>
        <div v-else>
          <div v-for="s in userStats?.recentSessions?.slice(0,5)" :key="s.id" class="flex items-center gap-3 p-3 bg-zinc-800/30 rounded mb-2">
            <img v-if="s.game?.mIconObjectId" :src="useObject(s.game.mIconObjectId)" class="size-8 rounded" />
            <div class="flex-1 min-w-0"><p class="text-sm text-zinc-100 truncate">{{ s.game?.mName }}</p><p class="text-xs text-zinc-500">{{ s.durationSeconds ? Math.round(s.durationSeconds/60)+'min' : 'Unknown duration' }}</p></div>
          </div>
          <p v-if="!userStats?.recentSessions?.length" class="text-zinc-500 text-sm">No sessions yet</p>
        </div>
      </div>
      <div>
        <h2 class="text-lg font-bold font-display text-zinc-100 mb-3">Recent Achievements</h2>
        <div v-if="activityLoading" class="text-zinc-500">Loading...</div>
        <div v-else>
          <div v-for="a in activity?.achievements?.slice(0,5)" :key="a.id" class="flex items-center gap-3 p-3 bg-zinc-800/30 rounded mb-2">
            <img :src="a.achievement?.iconUrl || '/favicon.ico'" class="size-8 rounded" />
            <div class="flex-1 min-w-0"><p class="text-sm text-zinc-100 truncate">{{ a.achievement?.title }}</p><p class="text-xs text-zinc-500">{{ a.game?.mName }}</p></div>
          </div>
          <p v-if="!activity?.achievements?.length" class="text-zinc-500 text-sm">No achievements yet</p>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useObject } from "~/composables/objects";
import { useUser } from "~/composables/user";

const route = useRoute();
const id = (route.params.id ?? "") as string;
const loading = ref(true);

const profile = await $dropFetch(`/api/v1/user/${id}`).catch(() => null) as { id?: string; username?: string; displayName?: string; bio?: string; profilePictureObjectId?: string; bannerObjectId?: string } | null;
const userStats = await $dropFetch(`/api/v1/user/${id}/stats`).catch(() => null);
const activity = await $dropFetch(`/api/v1/user/${id}/activity`).catch(() => null);
const activityLoading = ref(false);

loading.value = false;
const current = useUser();
const isCurrentUser = computed(() => !!current.value && current.value.id === profile?.id);
useHead({ title: profile?.displayName ?? profile?.username ?? "User" });
</script>
