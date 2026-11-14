#!/usr/bin/env bash
# Runs an operator-only Fargate job; credentials come from the task's Secrets Manager references.
set -euo pipefail
action="${1:-}"
slug="${2:-}"
case "$action" in
  bootstrap) [[ -z "$slug" ]] || { echo "bootstrap takes no slug" >&2; exit 2; } ;;
  backup-restore) [[ "$slug" =~ ^[a-z][a-z0-9_]{2,30}$ ]] || { echo "invalid slug" >&2; exit 2; } ;;
  *) echo "usage: scripts/run-db-admin.sh bootstrap | backup-restore <slug>" >&2; exit 2 ;;
esac
root="$(cd "$(dirname "$0")/.." && pwd)"
read -r region cluster definition subnets group < <(
  tofu -chdir="$root/infra/envs/dev" output -json | python3 -c '
import json,sys
o=json.load(sys.stdin)
print(o["region"]["value"],o["ecs_cluster"]["value"],o["db_admin_task_definition"]["value"],",".join(o["task_subnets"]["value"]),o["db_admin_security_group"]["value"])'
)
task="$(aws ecs run-task --region "$region" --cluster "$cluster" --launch-type FARGATE --platform-version 1.4.0 \
  --propagate-tags TASK_DEFINITION \
  --task-definition "$definition" \
  --network-configuration "awsvpcConfiguration={subnets=[$subnets],securityGroups=[$group],assignPublicIp=ENABLED}" \
  --overrides "{\"containerOverrides\":[{\"name\":\"admin\",\"command\":[\"$action\",\"$slug\"]}]}" \
  --output json | python3 -c '
import json,sys
r=json.load(sys.stdin)
if r.get("failures") or len(r.get("tasks",[]))!=1: sys.exit("Fargate job did not start: "+str(r.get("failures",[])))
print(r["tasks"][0]["taskArn"])')"
echo "started $task"
aws ecs wait tasks-stopped --region "$region" --cluster "$cluster" --tasks "$task"
status="$(aws ecs describe-tasks --region "$region" --cluster "$cluster" --tasks "$task" --output json)"
if ! aws logs get-log-events --region "$region" --log-group-name /unirise/dev/app \
  --log-stream-name "admin/admin/${task##*/}" --start-from-head --query 'events[].message' --output text; then
  echo "Could not read job logs; checking the task result." >&2
fi
printf '%s' "$status" | python3 -c '
import json,sys
t=json.load(sys.stdin)["tasks"][0]
c=next(c for c in t["containers"] if c["name"]=="admin")
if c.get("exitCode")!=0: sys.exit("Database job failed: "+str(c.get("exitCode"))+" "+t.get("stoppedReason","")+" "+c.get("reason",""))
print("database job completed successfully")'
