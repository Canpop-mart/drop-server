<template>
  <div class="max-w-7xl mx-auto px-4 py-8">
    <h1 class="text-3xl font-bold font-display text-zinc-100 mb-8">Community</h1>
    <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
      <div class="p-4 bg-zinc-800/50 rounded text-center">
        <p class="text-2xl font-bold text-blue-400">{{ stats?.totalGames||0 }}</p>
        <p class="text-sm text-zinc-400">Games</p>
      </div>
      <div class="p-4 bg-zinc-800/50 rounded text-center">
        <p class="text-2xl font-bold text-blue-400">{{ stats?.totalUsers||0 }}</p>
        <p class="text-sm text-zinc-400">Players</p>
      </div>
      <div class="p-4 bg-zinc-800/50 rounded text-center">
        <p class="text-2xl font-bold text-blue-400">{{ stats?.totalPlaytimeHours||0 }}h</p>
        <p class="text-sm text-zinc-400">Total Playtime</p>
      </div>
      <div class="p-4 bg-zinc-800/50 rounded text-center">
        <p class="text-2xl font-bold text-blue-400">{{ stats?.pendingRequests||0 }}</p>
        <p class="text-sm text-zinc-400">Pending Requests</p>
      </div>
    </div>
    <div class="grid grid-cols-1 lg:grid-cols-3 gap-8">
      <div class="lg:col-span-2">
        <h2 class="text-xl font-bold font-display text-zinc-100 mb-4">Recent Activity</h2>
        <ActivityFeed :items="activity" />
      </div>
      <div class="lg:col-span-1">
        <h2 class="text-xl font-bold font-display text-zinc-100 mb-4">Top Players</h2>
        <div class="space-y-2">
          <LeaderboardRow v-for="e in leaderboard?.playtime?.slice(0,10)" :key="e.rank" :rank="e.rank" :user="e.user" :playtime-hours="e.playtimeHours" :achievements="e.achievements" :games-owned="e.gamesOwned" />
        </div>
      </div>
    </div>
  </div>
</template>
<script lang="ts" setup>
useHead({ title: "Community" });
const activity = await $dropFetch('/api/v1/community/activity').catch(() => []) as Array<{ type: string; timestamp: Date | string; user?: { id?: string; username?: string; displayName?: string; profilePictureObjectId?: string }; game?: { mName?: string; mIconObjectId?: string }; data?: { achievement?: { title?: string; iconUrl?: string } } }>;
const stats = await $dropFetch('/api/v1/community/stats').catch(() => null);
const leaderboard = await $dropFetch('/api/v1/community/leaderboard').catch(() => ({ playtime: [] }));
</script>
