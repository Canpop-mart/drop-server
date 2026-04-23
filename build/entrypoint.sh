#!/bin/bash
#
# PUID/PGID entrypoint — lets deployers match the container's runtime uid
# to whatever owns their bind-mounted host paths. Mirrors the LinuxServer.io /
# Synology convention so users can set `PUID=1026` (or whatever) in compose
# and skip having to chown host files to 1000:1000.
#
# Flow:
#   1. Read PUID/PGID from env (default 1000:1000)
#   2. Mutate the in-image `node` user/group to match those ids
#   3. chown the runtime-writable roots so Prisma engines, nginx temp dirs,
#      and the Drop data dir are usable by the matched uid. `/library` is
#      deliberately NOT chowned recursively — users may have TB of game files,
#      and the top-level chown is enough for Drop to create new entries.
#   4. Drop privileges with gosu and exec launch.sh.
#
set -e

PUID=${PUID:-1000}
PGID=${PGID:-1000}

if [ "$(id -u node)" != "$PUID" ] || [ "$(id -g node)" != "$PGID" ]; then
    groupmod -o -g "$PGID" node
    usermod -o -u "$PUID" node
fi

# Runtime-writable paths. /library is intentionally shallow (`-R` omitted) —
# recursive chown on a multi-TB game library is a non-starter, and Drop only
# needs to create/modify content, not take ownership of existing files.
chown node:node /data /library 2>/dev/null || true
chown -R node:node /app /data 2>/dev/null || true

exec gosu node sh /app/startup/launch.sh
