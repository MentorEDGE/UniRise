#!/usr/bin/env bash
# Nightly per-tenant backup (MULTI_TENANCY_DESIGN.md section 8): one pg_dump per tenant database, optionally copied to S3.
# Usage: scripts/tenant-backup.sh <slug> [out-dir]      Needs PGHOST, PGPORT, PGUSER, PGPASSWORD (an admin login) and pg_dump on PATH.
# Set BACKUP_S3_URI (for example s3://unirise-dev-exports/backups) to upload as well. Bucket encryption and lifecycle come from infra/.
set -euo pipefail
slug="${1:?usage: tenant-backup.sh <slug> [out-dir]}"
[[ "$slug" =~ ^[a-z][a-z0-9_]{2,30}$ ]] || { echo "invalid slug" >&2; exit 2; }
out_dir="${2:-.}"
file="$out_dir/tenant_${slug}-$(date -u +%Y%m%dT%H%M%SZ).dump"
pg_dump --format=custom --no-owner --dbname="tenant_${slug}" --file="$file"
echo "wrote $file"
if [[ -n "${BACKUP_S3_URI:-}" ]]; then
  aws s3 cp "$file" "${BACKUP_S3_URI%/}/${slug}/$(basename "$file")" --sse AES256
fi
