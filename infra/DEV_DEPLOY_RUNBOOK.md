# UniRise dev deployment runbook

Updated 2026-11-04. Deployment completed and verified; the commands below are the repeatable operations record. AWS account `417441726165`, region `ap-south-1`, shared with MentorEDGE. Only resources named/tagged for UniRise are in scope. The current reviewable resource list and costs are in [DEV_ENV_IMPLEMENTATION_PLAN.md](DEV_ENV_IMPLEMENTATION_PLAN.md).

## Current state and design

The user chose the cheaper dev design: Fargate tasks with public IPs and restricted security groups, private RDS, an HTTPS load balancer, and temporary Fargate database administration jobs. No EC2 bastion, NAT gateway or paid interface endpoints are needed. The free S3 gateway endpoint stays.

The base VPC, subnets, RDS, S3, ECR, application log group, certificate and SES identity are already applied. RDS is available, encrypted and private at `unirise-dev.cn6m28eewk6s.ap-south-1.rds.amazonaws.com`. The certificate for `api.dev-unirise.mentoredge.co.in` is issued; SES domain verification and DKIM succeeded. SES is still in the sandbox.

The earlier apply created 45 of 48 planned additions. A bastion VM was never created: its EC2 launch hit a vCPU quota. The new design retires that dependency and removes its unused IAM/security-group/SSM resources after plan approval. The old AWS quota case `179378613200293` no longer blocks this design; no other project's resources are used.

The two manual secrets `unirise/dev/app-db` and `unirise/dev/admin-key` exist. Database roles are configured; live Fargate bootstrap returned success. The demo report and live encrypted S3 backup/restore passed. ECS is stable with one running task and public HTTPS health returns `UP`. The final OpenTofu plan has no changes.

The normal API task cannot read the RDS master secret. Only the separate admin execution role can inject the master password and app database password into an operator-started task.

Local checkout is `dev` at `9717fb9`, including local `main` and fetched `origin/main`, 11 commits ahead of `origin/dev`. Changes are uncommitted. No Git push is authorised. Root remains in use for now; IAM users and budget alerts were explicitly deferred by the user.

## Rules

- Show the full resource plan and costs and get an explicit yes before any apply, destroy or delete. The user's design choice authorises preparation; it does not replace review of the generated Terraform plan.
- Never write secret values to the repo, Terraform variables/state, command output or replies. Terraform stores secret ARNs only; ECS injects values at task startup.
- Keep RDS private. API task ingress is only from the ALB on `8080`; admin tasks have no ingress. Database ingress is only from the API and admin security groups on `5432`.
- Do not commit or push unless asked. When asked, commit locally and report before pushing.
- DNS changes are manual in Hostinger. Give the user the exact record and target.

## 1. Verify identity, images and the plan

Use AWS CLI v2, OpenTofu, Docker and Java 21. Check the account before any operation:

```bash
aws sts get-caller-identity --region ap-south-1
```

Build/test the API before pushing it. CORS is already implemented for `https://dev-unirise.mentoredge.co.in` on `/api/**`; the backend suite passed all 36 tests. The admin image has its own real PostgreSQL 16 check:

```bash
docker build --platform linux/arm64 -f scripts/db-admin/Dockerfile -t unirise-db-admin:check .
scripts/db-admin/check.sh
scripts/push-image.sh
scripts/push-image.sh db-admin
```

The image push helper accepts only this account and region. It uses the existing ECR repository `unirise-backend`; the API tag is the Git short SHA, the admin tag is `db-admin-` plus that SHA. Get both digests:

```bash
aws ecr describe-images --region ap-south-1 --repository-name unirise-backend --image-ids imageTag="$(git rev-parse --short HEAD)" --query 'imageDetails[0].imageDigest' --output text
aws ecr describe-images --region ap-south-1 --repository-name unirise-backend --image-ids imageTag="db-admin-$(git rev-parse --short HEAD)" --query 'imageDetails[0].imageDigest' --output text
```

Put the digests into `api_image_digest` and `db_admin_image_digest` in the git-ignored `infra/envs/dev/terraform.tfvars`. Keep the existing region/domain, empty budget email, and empty admin/developer lists. The two existing manual secrets must exist before planning.

```bash
cd infra/envs/dev
tofu init -backend-config=backend.hcl
tofu fmt -check
tofu validate
tofu plan -out=/private/tmp/unirise-dev-budget.tfplan
```

Review every addition, modification, replacement and deletion. The expected deletions are unused bastion IAM, security-group/rule and SSM resources. RDS, its existing security group, the buckets and unrelated infrastructure must not be destroyed or replaced. Stop for approval.

## 2. Apply the approved infrastructure

After approval, apply that saved plan. Do not use the superseded private-endpoint Stage E plan.

```bash
tofu apply /private/tmp/unirise-dev-budget.tfplan
tofu output
```

The API service may initially fail startup because its database login does not exist. Complete bootstrap next, then force a fresh API deployment. During the initial deployment this restart completed successfully; subsequent image deployments use the already-configured database.

## 3. Bootstrap the database through Fargate

From the repo root, as an operator authorised to run the admin task and pass its roles:

```bash
scripts/run-db-admin.sh bootstrap
```

The helper runs the digest-pinned admin image in a public subnet with no inbound ports. It waits for the task, prints its logs and checks the exit code. ECS injects the RDS-managed JSON `password` field and the existing app password from Secrets Manager. No password is fetched onto the laptop.

The job idempotently creates `unirise_dev` with IAM authentication and connection to `unirise`, and `unirise_app` with `LOGIN`, `CREATEROLE` and `CREATEDB`. It grants `pg_signal_backend`, grants the operator role membership needed to transfer database ownership, and makes `unirise_app` the control-plane database owner. The app role is not a superuser. Expected output: `database bootstrap OK`.

The admin task has a separate execution role and a task role limited to backup objects in the UniRise exports bucket. Developer IAM users do not receive permissions to launch privileged admin tasks or read the master secret. There is no always-running admin service.

## 4. Start and verify the API

After bootstrap, restart the API deployment and wait for health:

```bash
cd infra/envs/dev
aws ecs update-service --region ap-south-1 --cluster "$(tofu output -raw ecs_cluster)" --service "$(tofu output -raw ecs_service)" --force-new-deployment
aws ecs wait services-stable --region ap-south-1 --cluster "$(tofu output -raw ecs_cluster)" --services "$(tofu output -raw ecs_service)"
```

Verify healthy ALB targets, `UP` at `/actuator/health`, allowed-origin preflight, rejection of other origins and unauthenticated API requests, then an authenticated report. The operator key must be fetched into memory without printing it. Provision a synthetic `demo` institution, create test researcher/publication data, and keep the returned tenant key in memory while testing.

Provisioning through the deployed API records the real RDS endpoint, so the old laptop `localhost:15432` host gotcha does not apply. Never expose RDS or put operator/service keys into a frontend build.

## 5. Backup and restore drill

From the repo root:

```bash
scripts/run-db-admin.sh backup-restore demo
```

The temporary task reuses `tenant-backup.sh` and `restore-drill.sh` with PostgreSQL 16 tools. It uploads the encrypted dump under the exports bucket's `backups/demo/` prefix, restores a scratch database, compares table row counts and removes the scratch database. Expected output: `restore drill OK for demo`, followed by a successful job exit. Use a quiet test tenant so concurrent writes do not invalidate the row-count comparison. Exports expire after 30 days under the existing bucket lifecycle.

The local admin image check passed non-superuser bootstrap, idempotence, password login, role/owner checks and a real PostgreSQL backup/restore. Live AWS secret injection and the AES256-encrypted S3 upload also passed. This manual job is not a nightly backup schedule; automated RDS backups already protect the instance.

## 6. Hostinger DNS and completion

Under Domains > `mentoredge.co.in` > DNS records, the user adds a CNAME with name `api.dev-unirise` and target from `api_load_balancer_dns`. The zone appends `.mentoredge.co.in`. Keep the default TTL. The existing certificate and SES DKIM CNAMEs remain unchanged.

All backend completion checks passed: bootstrap, stable ECS/healthy ALB, demo report, live restore drill, public HTTPS health and a no-change OpenTofu plan. The user added CNAME `api.dev-unirise` -> `unirise-dev-api-2002016511.ap-south-1.elb.amazonaws.com`. IAM admin/MFA setup remains deferred by the current root override. The demo already exists; its one-time test credentials were kept in process memory and not retained. Create a separate test institution for new credential-based verification.

## Costs and remaining product work

At the checked Mumbai on-demand rates and 730 hours/month, the API task costs about $5.30/month, its public IPv4 address $3.65, ALB hourly usage $17.45 and its minimum two IPv4 addresses $7.30: about $33.70/month added baseline. RDS compute is about $15.33/month, plus storage, secrets and usage. Expect roughly $50–70/month for the dev environment before tax and variable usage. Temporary admin tasks add compute/IP charges only while running. No paid interface endpoints, NAT gateway or EC2 bastion are included. Budget alerts are disabled; there is no spending cap.

Rates checked through the AWS Price List API on 2026-11-04: ARM Fargate $0.02383/vCPU-hour and $0.00261/GiB-hour; ALB $0.0239/hour plus $0.008/LCU-hour; IPv4 $0.005/address-hour; RDS db.t4g.micro $0.021/hour. See [Fargate pricing](https://aws.amazon.com/fargate/pricing/), [ALB pricing](https://aws.amazon.com/elasticloadbalancing/pricing/) and [VPC pricing](https://aws.amazon.com/vpc/pricing/).

Frontend contract integration, tenant credentials in Secrets Manager, SES invitations and OIDC remain product work. `unirise-web` was superseded and removed (2026-11-14); `rdms-web`, the product frontend, has its own Node/SQLite backend. It does not become a Spring client by flipping a URL or flag. CORS is implemented, but it becomes live only after this image is deployed.
