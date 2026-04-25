# Compatibility Test Rig — Phase A

Standalone bash tooling that launches each Drop-installed Windows game,
classifies the outcome, and POSTs the result to drop-server's compat API.
Lets you build a per-(game, client) compatibility map of your library
**without** waiting for the integrated worker (Phase C/D).

## What it does

1. Reads a CSV of games you want to test (one per row).
2. For each game: cleans up any prior wineserver, launches the exe under
   umu/Proton, watches it for ~45s, classifies the outcome (`alive_renders`,
   `alive_no_render`, `crash`, `early_exit`, `no_launch`).
3. Asks you (Y/N) whether the menu actually rendered, when the process
   stays alive — auto-classifying as `alive_no_render` until you confirm.
4. POSTs each result to `POST /api/v1/client/compat/results` so it lands
   in the `GameCompatibilityResult` table on drop-server.

The same data backs the admin summary endpoint (`GET /api/v1/admin/compat/summary`)
and, eventually, library UI badges (Phase B).

## Required env

```bash
export DROP_SERVER=http://your-drop-server:3000
export CLIENT_ID=<your client UUID>     # find in drop-client config / DB
export CLIENT_JWT=<a current client JWT> # signed with the client cert
```

The `CLIENT_JWT` is the same auth token drop-client uses for its own API
calls. Fastest way to grab one for ad-hoc testing: run drop-client with
network logging enabled and copy the `Authorization: JWT ...` header from
any request, or generate one server-side via the existing CA flow.

For a Steam Deck client running in your home network, you'll likely also
want to export display env vars before running tests:

```bash
DROP_PID=$(pgrep -f drop-app | head -1)
while IFS='=' read -r k v; do
  case "$k" in
    DISPLAY|XAUTHORITY|XDG_RUNTIME_DIR|XDG_SESSION_TYPE|DBUS_SESSION_BUS_ADDRESS) export "$k=$v" ;;
  esac
done < <(tr '\0' '\n' < /proc/$DROP_PID/environ)
```

## Single-game test

```bash
GAME_ID=<drop game uuid> \
NOTES="testing on Deck Desktop Mode" \
./test-game.sh \
  <prefix-uuid> \
  "/home/deck/.local/share/drop/games/F1 2021/F1_2021_dx12.exe" \
  1080110
```

Output: one line of `<status>|<elapsed>|<signature>` plus the path to the
captured wine log for inspection.

## Batch testing

Construct a CSV with `gameId,prefixUuid,exePath,appid` (one row per
installed game), then loop:

```bash
while IFS=, read -r gameId pfx exe appid; do
  GAME_ID="$gameId" ./test-game.sh "$pfx" "$exe" "$appid" || true
done < games.csv
```

## What's a result good for?

Once you have a few hundred rows in `GameCompatibilityResult`, you can:

```bash
# Histogram across the library
curl -fsS "$DROP_SERVER/api/v1/admin/compat/summary" \
  -H "Authorization: <admin token>" | jq

# Or query the DB directly
psql -d drop -c "
  SELECT status, COUNT(*) FROM \"GameCompatibilityResult\"
  GROUP BY status ORDER BY 2 DESC
"

# Cluster crashes by signature — same fingerprint = same root cause
psql -d drop -c "
  SELECT signature, COUNT(*) FROM \"GameCompatibilityResult\"
  WHERE status = 'crash'
  GROUP BY signature ORDER BY 2 DESC
"
```

## What's next (Phase B/C/D)

- **Phase B**: library UI badges (green/yellow/red per platform).
- **Phase C**: drop-client background worker — install, test, uninstall,
  loop, all without bash. Replaces this rig for real use.
- **Phase D**: server-side `compat:scan` task that auto-queues untested
  games + a manual-confirm UI for `alive_no_render` results.

This rig is intentionally minimal: it exists so we can populate the table
with real data right now while Phase C ships at its own pace.
