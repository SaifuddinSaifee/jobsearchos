#!/usr/bin/env bash
# Starts Postgres (Docker), creates the dev and test databases if missing, and applies migrations to both.
# Safe to re-run. Usage: npm run db:setup
set -euo pipefail
cd "$(dirname "$0")/.."

# Load .env so DATABASE_URL / TEST_DATABASE_URL match the port docker compose uses.
if [ -f .env ]; then set -a; . ./.env; set +a; fi

DEV_URL="${DATABASE_URL:-postgres://jobtracker:jobtracker@localhost:5432/jobtracker}"
TEST_URL="${TEST_DATABASE_URL:-postgres://jobtracker:jobtracker@localhost:5432/jobtracker_test}"

echo "Starting Postgres..."
docker compose up -d --wait postgres

echo "Ensuring test database exists..."
docker compose exec -T postgres psql -U jobtracker -d jobtracker -tAc \
  "SELECT 1 FROM pg_database WHERE datname = 'jobtracker_test'" | grep -q 1 \
  || docker compose exec -T postgres psql -U jobtracker -d jobtracker -c "CREATE DATABASE jobtracker_test"

echo "Migrating dev database..."
npm run --silent db:migrate -- "$DEV_URL"
echo "Migrating test database..."
npm run --silent db:migrate -- "$TEST_URL"

echo "Done."
