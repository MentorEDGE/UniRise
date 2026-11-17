#!/usr/bin/env bash
# Loads the sample institutions (ABC Institute of Technology, XYZ University) into a UniRise Java API as sandbox
# institutions. Every account gets the demo password (src/lib/demo.ts), or with RANDOM_PASSWORD=1 one new random
# password, printed once here in the terminal. Operator only: needs the platform operator key in RMS_ADMIN_KEY.
#
#   RMS_ADMIN_KEY=... scripts/load-demo.sh https://api.dev-unirise.mentoredge.co.in
#
# For the AWS dev API, the key is in Secrets Manager (unirise/dev/admin-key); see the README. Run it once: an institution
# that already exists, or already has records, is refused by the API and left as it is.
set -euo pipefail
api="${1:?usage: RMS_ADMIN_KEY=... scripts/load-demo.sh <api address>}"
: "${RMS_ADMIN_KEY:?set RMS_ADMIN_KEY to the platform operator key}"
here="$(cd "$(dirname "$0")/.." && pwd)"
work="$(mktemp -d)"
cleanup() { rm -f "$work"/*.json; rmdir "$work"; }
trap cleanup EXIT

# The demo password goes to the terminal (stderr); the data, which also contains it, stays in the temporary folder.
(cd "$here" && npx tsx scripts/export-demo.ts ${RANDOM_PASSWORD:+--random-password}) > "$work/all.json"
python3 - "$work" <<'PY'
import json, sys, os
work = sys.argv[1]
for inst in json.load(open(os.path.join(work, "all.json"))):
    json.dump({"slug": inst["slug"], "name": inst["name"]}, open(os.path.join(work, inst["slug"] + "-tenant.json"), "w"))
    json.dump({"db": inst["db"], "accounts": inst["accounts"]}, open(os.path.join(work, inst["slug"] + "-data.json"), "w"))
PY

for f in "$work"/*-tenant.json; do
  slug="$(basename "$f" -tenant.json)"
  # Create the institution. The response holds its new service key; it is not needed for a demo, so it is not shown.
  code="$(curl -s -o /dev/null -w '%{http_code}' -X POST "$api/api/platform/tenants" -H "X-Admin-Key: $RMS_ADMIN_KEY" -H 'Content-Type: application/json' --data-binary @"$f")"
  echo "$slug: institution created (HTTP $code)"
  echo "$slug: loading data and accounts..."
  curl -s -X POST "$api/api/platform/tenants/$slug/demo-data" -H "X-Admin-Key: $RMS_ADMIN_KEY" -H 'Content-Type: application/json' --data-binary @"$work/$slug-data.json"
  echo
done
