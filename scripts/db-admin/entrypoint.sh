#!/usr/bin/env bash
set -euo pipefail
case "${1:-}" in
  bootstrap)
    : "${APP_DB_PASSWORD:?application database password must be injected from Secrets Manager}"
    psql -X -q -v ON_ERROR_STOP=1 -v app_password="$APP_DB_PASSWORD" <<'SQL'
SELECT 'CREATE ROLE unirise_dev LOGIN' WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'unirise_dev') \gexec
GRANT rds_iam TO unirise_dev;
GRANT CONNECT ON DATABASE unirise TO unirise_dev;
SELECT 'CREATE ROLE unirise_app LOGIN CREATEROLE CREATEDB' WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'unirise_app') \gexec
ALTER ROLE unirise_app LOGIN CREATEROLE CREATEDB PASSWORD :'app_password';
GRANT pg_signal_backend TO unirise_app;
GRANT unirise_app TO CURRENT_USER;
ALTER DATABASE unirise OWNER TO unirise_app;
SQL
    echo "database bootstrap OK"
    ;;
  backup-restore)
    : "${BACKUP_S3_URI:?backup destination must be configured}"
    slug="${2:?tenant slug required}"
    work="$(mktemp -d)"
    trap 'rm -rf "$work"' EXIT
    /scripts/tenant-backup.sh "$slug" "$work"
    /scripts/restore-drill.sh "$slug" "$work"/*.dump
    ;;
  *) echo "usage: unirise-db-admin bootstrap | backup-restore <slug>" >&2; exit 2 ;;
esac
