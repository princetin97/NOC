#!/bin/sh
set -e

if [ "$RUN_MIGRATIONS" = "true" ]; then
  echo "Running prisma migrate deploy..."
  npx prisma migrate deploy
  echo "Seeding default alert rules..."
  npx tsx prisma/seed.ts || true
fi

exec "$@"
