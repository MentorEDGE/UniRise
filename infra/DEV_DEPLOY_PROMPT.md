# Prompt: operate the UniRise Fargate dev environment

The dev backend deployment was completed and verified on 2026-11-04. Read current state before repeating any provisioning: the demo exists, public HTTPS health is UP, backup/restore passed, and Terraform has no drift. The work order below is for a fresh deployment or an explicitly requested update; do not replay it automatically.

Open the agent at the repository root. Read these first:

1. `infra/DEV_ENV_IMPLEMENTATION_PLAN.md` for the current reviewed scope and cost estimate.
2. `infra/DEV_DEPLOY_RUNBOOK.md` for current AWS state and commands.
3. `infra/README.md` for the Terraform file map.
4. `rms-docs/MULTI_TENANCY_DESIGN.md` and `unirise-api/README.md` for tenancy and application constraints.

## Accepted dev design

Use ARM64 Fargate for the API, an HTTPS ALB, private RDS, and temporary Fargate jobs for database administration. API tasks have public IPs for outbound HTTPS and accept inbound traffic only from the ALB. Admin tasks have no inbound ports. The database accepts only the API and admin security groups. Remove the unused bastion IAM/network/SSM resources; no EC2 bastion VM exists. Do not add NAT or paid interface endpoints. This replaces the earlier bastion/private-endpoint design at the user's explicit request.

## Current constraints

- AWS account `417441726165`, region `ap-south-1`, shared with MentorEDGE. Touch only UniRise resources.
- The base VPC, private RDS, buckets, ECR, logs, certificate and SES domain are already applied. The current plan document records what remains.
- The two required secrets already exist. Fetch/inject their existing values; do not regenerate credentials or put values into Terraform, files, logs, replies or Git.
- Root is currently authorised temporarily by the user. IAM human users/MFA setup and budget alerts were deferred. Do not ask for those inputs again unless that scope is reopened.
- The EC2 quota case no longer blocks the chosen design. Do not expose RDS or use another project's resources.
- DNS is manual in Hostinger's `mentoredge.co.in` zone. After ALB creation, give the user type CNAME, name `api.dev-unirise`, and the exact ALB target.
- The local branch is `dev`, including both local and remote main. No Git commit/push is authorised.

## Work order

1. Verify AWS identity and the repository state. Validate the API/admin image tests and digests.
2. Generate and show the full Terraform plan, including unused bastion cleanup and the updated monthly estimate. Wait for explicit approval before apply or deletion. Never apply a superseded saved plan.
3. Apply only the approved plan. Run `scripts/run-db-admin.sh bootstrap` and confirm success. The initial API deployment may fail until the database roles exist; force a fresh deployment after bootstrap and wait for health.
4. Provision a synthetic demo institution through the deployed API, seed test data, and verify a report. Keep returned keys in memory. No laptop database tunnel is required; provisioned tenant rows already store the real RDS address.
5. Run `scripts/run-db-admin.sh backup-restore demo`, confirm S3 upload and `restore drill OK`, then check the task exit code.
6. Provide the Hostinger CNAME and verify DNS/HTTPS health after the user adds it. Verify CORS/authentication and that OpenTofu has no remaining changes.
7. Update repo deployment docs and the concise Obsidian handoff. Report passed checks and remaining gaps honestly.

CORS for the dev website is implemented and tested. Frontend API/authentication contracts, SES invitation delivery, OIDC and moving tenant credentials out of the control-plane table remain application work; do not claim these are complete or put operator/service keys in browser variables. Do not commit or push unless asked; when asked, commit locally and report before pushing.
