#!/bin/sh
set -e

if [ "${MIGRATE_ON_START:-true}" = "true" ]; then
  bun --bun run db:migrate
fi

exec bun .output/server/index.mjs
