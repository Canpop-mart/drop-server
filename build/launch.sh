#!/bin/bash

# Starts the Drop server: apply database migrations, then run the server.
#
# Prisma is called directly rather than through `pnpm`. pnpm comes from
# corepack, which only cached it for root at build time; entrypoint.sh drops
# to the `node` user first, so `pnpm prisma ...` failed with "Network access
# disabled" and the server then started on an unmigrated database.
#
# A failed migration stops the container instead of starting a server whose
# new features would fail on missing columns. It is retried a few times first
# in case Postgres is still coming up.
echo "[Drop] performing migrations..."
attempt=1
until /app/node_modules/.bin/prisma migrate deploy; do
  if [ "$attempt" -ge 5 ]; then
    echo "[Drop] database migrations failed after $attempt attempts; not starting the server." >&2
    exit 1
  fi
  echo "[Drop] migrations failed (attempt $attempt), retrying in 5s..." >&2
  attempt=$((attempt + 1))
  sleep 5
done

# Actually start the application
exec node /app/app/server/index.mjs
