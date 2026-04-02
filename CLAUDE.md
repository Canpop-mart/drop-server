# Drop Server — Notes for Claude

## Dual-Surface Rule (PERMANENT)

**Every feature must consider both the web server and the desktop client.**

Drop has two surfaces:
- **Web** (`drop-server`) — Nuxt 3 server, accessed via browser
- **Client** (`drop-app`) — Tauri desktop app, which has its own native pages AND embeds server pages via `server://` iframes

When implementing any feature, always explicitly decide what happens on each surface:

| Strategy | When to use |
|---|---|
| **Native on both** | Feature needs different behaviour per surface (e.g. library game page needs Tauri `invoke()` on client, web fetch on server) |
| **Web only** | Feature is web-only by nature (admin panel, auth pages, account settings) |
| **Client iframe** | Feature works fine as a web page embedded in the client (community, news, requests, profile, store) |
| **Not needed on client** | Feature is irrelevant in a desktop context |

The client detects whether a web page is embedded using `isClientRequest()` (User-Agent: `Drop Desktop Client`), which hides the header/footer via the default layout's `v-if="!clientRequest"`.

**Never ship a feature to one surface and leave the other as "Under Construction" without a deliberate, documented reason.**

---

## Architecture Notes

- `server://` protocol — Tauri custom protocol that proxies all requests to the Drop backend with auth headers automatically applied. Used for iframes and API calls from the client.
- `object://` protocol — Tauri protocol for game media (banners, covers, icons). On web, `useObject(id)` returns `/api/v1/object/{id}`.
- Achievement icon URLs are raw CDN URLs (Steam / RetroAchievements), not proxied through the object store.
- `$dropFetch` — SSR-aware fetch wrapper with state hydration. Use instead of `$fetch` in pages.
- `PLATFORM_ICONS` — auto-imported from `composables/icons.ts`.
