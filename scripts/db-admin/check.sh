#!/usr/bin/env bash
# Exercises the real admin image against a disposable PostgreSQL 16 server; never uses AWS.
set -euo pipefail
image="${1:-unirise-db-admin:check}"
network="unirise-db-admin-check-$$"
db="$network-db"
export POSTGRES_PASSWORD="$(openssl rand -hex 24)"
export PGPASSWORD="$POSTGRES_PASSWORD"
export APP_DB_PASSWORD="$(openssl rand -hex 24)"
trap 'docker rm -f "$db" >/dev/null 2>&1 || true; docker network rm "$network" >/dev/null 2>&1 || true' EXIT
docker network create "$network" >/dev/null
docker run -d --name "$db" --network "$network" -e POSTGRES_PASSWORD \
  -e POSTGRES_DB=unirise postgres:16-bookworm >/dev/null
for attempt in {1..30}; do
  if docker exec "$db" pg_isready -U postgres -d unirise >/dev/null 2>&1; then break; fi
  sleep 1
done
docker exec "$db" pg_isready -U postgres -d unirise >/dev/null
docker exec -i "$db" bash -ec 'exec psql -Xq -v ON_ERROR_STOP=1 -v password="$POSTGRES_PASSWORD" -U postgres -d unirise' <<'SQL'
CREATE ROLE unirise_admin LOGIN CREATEROLE CREATEDB PASSWORD :'password';
CREATE ROLE rds_iam;
GRANT rds_iam, pg_signal_backend TO unirise_admin WITH ADMIN OPTION;
ALTER DATABASE unirise OWNER TO unirise_admin;
SQL
run_admin() {
  docker run --rm --network "$network" -e PGHOST="$db" -e PGUSER=unirise_admin \
    -e PGDATABASE=unirise -e PGSSLMODE=disable -e PGPASSWORD -e APP_DB_PASSWORD "$image" "$@"
}
run_admin bootstrap
run_admin bootstrap
roles="$(docker exec "$db" psql -XAt -U unirise_admin -d unirise -c "SELECT count(*) FROM pg_roles WHERE (rolname = 'unirise_app' AND rolcanlogin AND rolcreatedb AND rolcreaterole AND NOT rolsuper) OR (rolname = 'unirise_dev' AND rolcanlogin AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolsuper)")"
[[ "$roles" == 2 ]] || { echo "incorrect database role permissions" >&2; exit 1; }
owner="$(docker exec "$db" psql -XAt -U unirise_admin -d unirise -c "SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname='unirise'")"
[[ "$owner" == unirise_app ]] || { echo "incorrect database owner" >&2; exit 1; }
PGPASSWORD="$APP_DB_PASSWORD" docker run --rm --network "$network" --entrypoint psql \
  -e PGHOST="$db" -e PGUSER=unirise_app -e PGDATABASE=unirise -e PGPASSWORD "$image" -Xq -v ON_ERROR_STOP=1 -c 'SELECT 1' >/dev/null
docker exec "$db" createdb -U unirise_admin tenant_demo
docker exec "$db" psql -Xq -v ON_ERROR_STOP=1 -U unirise_admin -d tenant_demo \
  -c 'CREATE TABLE sample(id int PRIMARY KEY); INSERT INTO sample VALUES (1),(2),(3);'
docker run --rm --network "$network" --entrypoint bash -e PGHOST="$db" -e PGUSER=unirise_admin \
  -e PGDATABASE=unirise -e PGSSLMODE=disable -e PGPASSWORD "$image" -ec '
work="$(mktemp -d)"
/scripts/tenant-backup.sh demo "$work"
/scripts/restore-drill.sh demo "$work"/*.dump'
# backup-all: every live institution in the control plane, none of the others; S3 replaced by a local stand-in.
docker exec "$db" createdb -U unirise_admin tenant_second
docker exec "$db" psql -Xq -v ON_ERROR_STOP=1 -U unirise_admin -d unirise -c "
  CREATE TABLE institution(slug text PRIMARY KEY, status text NOT NULL);
  INSERT INTO institution VALUES ('demo','sandbox'), ('second','active'), ('gone','closed'), ('half','provisioning');"
mkdir -p "$HOME/.cache"; uploads="$(mktemp -d "$HOME/.cache/db-admin-check.XXXXXX")"; chmod 777 "$uploads" # under HOME: Colima shares only the home folder with Docker
printf '%s\n' '#!/bin/sh' '# stand-in for: aws s3 cp <file> s3://bucket/backups/<slug>/<name> --sse AES256' 'cp "$3" "/uploads/$(basename "$(dirname "$4")")-$(basename "$4")"' > "$uploads/aws"
chmod 755 "$uploads/aws"
docker run --rm --network "$network" -v "$uploads:/uploads" -v "$uploads/aws:/usr/local/bin/aws:ro" -e PGHOST="$db" -e PGUSER=unirise_admin \
  -e PGDATABASE=unirise -e PGSSLMODE=disable -e PGPASSWORD -e BACKUP_S3_URI=s3://example/backups "$image" backup-all
ls "$uploads" | grep -q '^demo-tenant_demo-.*\.dump$' || { echo "backup-all missed demo" >&2; exit 1; }
ls "$uploads" | grep -q '^second-tenant_second-.*\.dump$' || { echo "backup-all missed second" >&2; exit 1; }
[[ "$(ls "$uploads" | grep -c '\.dump$')" == 2 ]] || { echo "backup-all backed up closed or unfinished institutions" >&2; exit 1; }
rm -rf "$uploads"
if run_admin invalid >/dev/null 2>&1; then echo "invalid action accepted" >&2; exit 1; fi
root="$(cd "$(dirname "$0")/../.." && pwd)"
if "$root/scripts/run-db-admin.sh" backup-restore '../../invalid' >/dev/null 2>&1; then echo "invalid slug accepted" >&2; exit 1; fi
echo "admin image checks OK (non-superuser bootstrap, idempotence, credentials, role permissions, restore and backup-all)"
