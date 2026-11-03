#!/usr/bin/env bash
# Restore drill: restores a tenant dump into a scratch database and compares row counts with the live tenant.
# An untested backup is not a backup, so run this on a schedule (at least quarterly) and keep the output.
# Usage: scripts/restore-drill.sh <slug> <dump-file>     Needs PGHOST, PGPORT, PGUSER, PGPASSWORD (an admin login).
set -euo pipefail
slug="${1:?usage: restore-drill.sh <slug> <dump-file>}"; dump="${2:?dump file}"
[[ "$slug" =~ ^[a-z][a-z0-9_]{2,30}$ ]] || { echo "invalid slug" >&2; exit 2; }
scratch="drill_${slug}_$$"
trap 'dropdb --if-exists "$scratch" >/dev/null 2>&1 || true' EXIT
createdb "$scratch"
pg_restore --no-owner --dbname="$scratch" "$dump"
counts() {   # exact row counts for every table in the public schema
  psql -At -d "$1" -c "SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY 1" |
  while read -r t; do printf '%s %s\n' "$t" "$(psql -At -d "$1" -c "SELECT count(*) FROM \"$t\"")"; done
}
if diff <(counts "tenant_${slug}") <(counts "$scratch"); then echo "restore drill OK for ${slug}"; else echo "restore drill DIFFERS for ${slug}" >&2; exit 1; fi
