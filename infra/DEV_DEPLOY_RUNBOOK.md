# UniRise dev on AWS: setup and deploy runbook

Written 2026-11-04 from the real state of the repo and the AWS account. Region `ap-south-1`, account `417441726165` (shared with MentorEDGE).
Companion files: `infra/README.md` (what each Terraform file creates), `rms-docs/MULTI_TENANCY_DESIGN.md` (why one database per institution), `unirise-api/README.md` (the API's settings), `infra/DEV_DEPLOY_PROMPT.md` (a prompt to hand this runbook to an AI agent).

Rules that apply to every step:
- **Read every `plan` before you apply.** Nothing here is meant to be applied blind.
- **Stop using the root login once the first admin exists** (stage B).
- **No secrets in git, in chat, in Terraform variables or in Terraform state.** Passwords go into Secrets Manager by hand.
- Tools: `tofu` (OpenTofu) is what was used and tested. `terraform` 1.10 or newer works the same.

## 0. State today (checked 2026-11-04)

| Item | State |
|---|---|
| Terraform state bucket `unirise-tfstate-417441726165` | Created (stack `infra/bootstrap`) |
| Dev stack `infra/envs/dev` | **Only 3 resources applied**: the certificate request for `api.dev-unirise.mentoredge.co.in`, the SES domain identity `dev-unirise.mentoredge.co.in`, and the SES configuration set. State is in the bucket above. Local files `backend.hcl` and `terraform.tfvars` exist (git-ignored; `tfvars` only sets `region` and `domain_name`). |
| DNS records in Hostinger | 4 CNAMEs added (certificate validation and 3 SES DKIM). Live and correct. |
| SES domain | **Verified**, DKIM `SUCCESS`. Still in the SES sandbox (can only mail verified addresses). |
| ACM certificate | `PENDING_VALIDATION` at last check. It turns `ISSUED` by itself; recheck with the command in section 9. |
| Database, network, bastion, S3, ECR, IAM, budget | **Not created yet** |
| API image | Builds and runs locally; **not pushed** (no ECR repository exists yet) |
| ECS service, load balancer | **Not written** (no `ecs.tf`); section 6 specifies it |
| AWS login | The CLI is signed in as the **root user** |

Local repo: 7 backend commits and the infra commits are on `main` and **not pushed** to GitHub.

## 1. Before you start

You need:
- A **budget alert email**, an IAM **admin user name** (for example `surya`), and optionally developer names.
- Installed: AWS CLI v2, OpenTofu or Terraform, Docker, `psql`, and the **Session Manager plugin** (`brew install --cask session-manager-plugin`).
- `aws login` done in this terminal. Check:
```bash
aws sts get-caller-identity
```

## 2. Stage A: create the whole dev environment

```bash
cd infra/envs/dev
```
Edit `terraform.tfvars` (git-ignored). Keep the two existing lines and add yours:
```hcl
region             = "ap-south-1"
domain_name        = "dev-unirise.mentoredge.co.in"
budget_email       = "you@example.com"
monthly_budget_usd = 50
admins             = ["your-admin-name"]
developers         = []
# leave ses_sender_email empty: the whole domain is already verified in SES
```
```bash
tofu init -backend-config=backend.hcl
```
```bash
tofu plan -out=dev.plan
```
**Read the plan.** Expect about 70 to 90 resources, all named `unirise-dev-*` and tagged `Project=UniRise`: VPC with 2 public and 2 private subnets, S3 gateway endpoint, RDS PostgreSQL 16 (`db.t4g.micro`), bastion `t4g.nano`, SSM tunnel document, S3 buckets `uploads` and `exports`, ECR `unirise-backend`, a CloudWatch log group, IAM groups `unirise-developers` and `unirise-admins`, your admin user, the MFA-required policy, and the budget. Nothing may be named outside `unirise`. Roughly US$20 to 40 a month.
```bash
tofu apply dev.plan
```
Then note the outputs:
```bash
tofu output
```

## 3. Stage B: first admin, then stop using root

1. Give your admin user a console login (a one-time temporary password you share with yourself privately):
```bash
aws iam create-login-profile --user-name your-admin-name --password-reset-required --password 'TEMPORARY-PASSWORD-HERE'
```
2. Sign in to the AWS console as that user, set a new password, and **set up MFA** (the policy denies everything else until you do).
3. In the terminal, sign in with `aws login` and choose the IAM user (the CLI supports console-style login for IAM users). Confirm:
```bash
aws sts get-caller-identity
```
The ARN must end in `user/unirise/your-admin-name`, **not** `:root`. From here on, never use root.

## 4. Stage C: database logins and secrets (one time, by the admin)

1. Open the tunnel (leave it running in its own terminal tab). The command is the `db_tunnel_command` output:
```bash
tofu output -raw db_tunnel_command
```
2. Get the master password **without printing it** and connect as `unirise_admin`. The secret ARN is the `rds_secret_arn` output:
```bash
PGPASSWORD=$(aws secretsmanager get-secret-value --secret-id "$(tofu output -raw rds_secret_arn)" --query SecretString --output text | python3 -c "import sys,json;print(json.load(sys.stdin)['password'])") psql "host=localhost port=15432 dbname=unirise user=unirise_admin sslmode=require"
```
3. In `psql`, run (use a freshly generated password for `unirise_app`, for example `openssl rand -hex 24` in another tab; do not reuse any other password):
```sql
-- developers: IAM sign-in, connect to the control-plane database only
CREATE USER unirise_dev;
GRANT rds_iam TO unirise_dev;
GRANT CONNECT ON DATABASE unirise TO unirise_dev;

-- the API: may create institution databases, is not a superuser (tested in NonSuperuserTest)
CREATE ROLE unirise_app LOGIN PASSWORD 'GENERATED-PASSWORD' CREATEROLE CREATEDB;
GRANT pg_signal_backend TO unirise_app;
ALTER DATABASE unirise OWNER TO unirise_app;
```
4. Store that password in Secrets Manager (so it never enters Terraform state), and make an operator key for the API the same way:
```bash
aws secretsmanager create-secret --region ap-south-1 --name unirise/dev/app-db --secret-string 'GENERATED-PASSWORD'
```
```bash
aws secretsmanager create-secret --region ap-south-1 --name unirise/dev/admin-key --secret-string "$(openssl rand -hex 32)"
```

## 5. Stage D: push the image and run the API against dev

1. Push the image (needs Docker running; builds for arm64 and pushes tag = git short sha to ECR `unirise-backend`):
```bash
scripts/push-image.sh
```
2. Run the API **on your laptop** against dev RDS through the open tunnel. Fetch the two secrets into environment variables without printing them, then start it:
```bash
export RMS_DB_PASSWORD=$(aws secretsmanager get-secret-value --secret-id unirise/dev/app-db --query SecretString --output text) RMS_ADMIN_KEY=$(aws secretsmanager get-secret-value --secret-id unirise/dev/admin-key --query SecretString --output text)
```
```bash
cd unirise-api && CONTROL_DB_URL='jdbc:postgresql://localhost:15432/unirise?sslmode=require' CONTROL_DB_USER=unirise_app TENANT_DB_HOST=localhost TENANT_DB_PORT=15432 TENANT_DB_JDBC_PARAMS=sslmode=require JAVA_HOME=~/.jdks/temurin21/Contents/Home ./mvnw spring-boot:run
```
3. Prove it end to end (in another tab; `$RMS_ADMIN_KEY` is exported above):
```bash
curl -s -X POST localhost:8080/api/platform/tenants -H "X-Admin-Key: $RMS_ADMIN_KEY" -H 'Content-Type: application/json' -d '{"slug":"demo","name":"Demo University"}'
```
The response holds that institution's API key, shown once. Use it as `X-API-Key` to create a researcher and open `/api/reports/pub-university`. Then take a backup and run the restore drill (`scripts/tenant-backup.sh`, `scripts/restore-drill.sh`, which need PostgreSQL 16 client tools and the `PG*` variables; the drill ran inside a `postgres:16` container in the tests).

**Gotcha: where the database host is stored.** Each institution row in the control plane stores `db_host` and `db_port` from `TENANT_DB_HOST`/`TENANT_DB_PORT` **at provisioning time**. Provisioning from a laptop stores `localhost:15432`, which is wrong for the ECS service. Either delete the demo institutions before moving to ECS (suspend, set `closing`, delete: retention is 30 days by default, set `TENANT_RETENTION_DAYS=0` for dev), or fix the rows:
```sql
UPDATE institution SET db_host = '<rds_endpoint>', db_port = 5432;
```

## 6. Stage E: ECS behind a load balancer (still to be written)

No `ecs.tf` exists. Write it with these requirements, then plan and apply as in stage A (cost: about US$30 to 45 a month more):
- ECS cluster, Fargate task definition **arm64**, 0.25 vCPU / 0.5 GB, one service with desired count 1, in the **private subnets**, image `<ecr_repository_url>:<tag>`.
- Task environment: `CONTROL_DB_URL=jdbc:postgresql://<rds_endpoint>:5432/unirise?sslmode=require`, `CONTROL_DB_USER=unirise_app`, `TENANT_DB_HOST=<rds_endpoint>`, `TENANT_DB_PORT=5432`, `TENANT_DB_JDBC_PARAMS=sslmode=require`. Task **secrets** from Secrets Manager: `RMS_DB_PASSWORD` from `unirise/dev/app-db`, `RMS_ADMIN_KEY` from `unirise/dev/admin-key`.
- Execution role (pull from ECR, write logs to `/unirise/dev/app`, read those two secrets only) and a task role (the `uploads` and `exports` buckets, SES send).
- Security groups: load balancer in from the internet on 443 (consider limiting to known IPs at first, because `/api/platform/**` is guarded only by the operator key); tasks in from the load balancer on 8080; **add an ingress rule on the database security group (`aws_security_group.db`) from the task security group on 5432** (today it only allows the bastion).
- Application Load Balancer in the public subnets: HTTPS listener using the issued ACM certificate for `api.dev-unirise.mentoredge.co.in`, HTTP listener redirecting to HTTPS, target group health check `/actuator/health` on 8080.
- **No NAT gateway exists**, so private tasks need VPC interface endpoints for `ecr.api`, `ecr.dkr`, `secretsmanager` and `logs` (the S3 gateway endpoint already exists). Alternative: tasks in public subnets with a public IP, locked down by security group; cheaper but less clean.
- Output the load balancer's DNS name. Deploy updates with `scripts/push-image.sh` then `aws ecs update-service --cluster ... --service ... --force-new-deployment`.
- Hostinger: add the last CNAME (section 7).

## 7. DNS records (Hostinger, zone `mentoredge.co.in`)

`dev-unirise.mentoredge.co.in` is **not its own zone**: it is a record inside `mentoredge.co.in` (the "external domain" page for it in hPanel fails with "Domain not found"). Add records under **Domains → mentoredge.co.in → DNS records**, with the Name ending in `.dev-unirise` (the panel adds `.mentoredge.co.in`). Field names: Type, Name, Target, TTL (leave the default).

Already added and verified:
| Type | Name | Target |
|---|---|---|
| CNAME | `_356c950350455a94c758ba98023804fa.api.dev-unirise` | `_c13e9757c8d89dbf47103ae3daab35ec.wzccmgtwzk.acm-validations.aws.` |
| CNAME | `yvjnv7hfitje3wpj5dxpeiozhm7bmcp6._domainkey.dev-unirise` | `yvjnv7hfitje3wpj5dxpeiozhm7bmcp6.dkim.amazonses.com` |
| CNAME | `wozpakfhti6twozaavg3xklzl43xas4o._domainkey.dev-unirise` | `wozpakfhti6twozaavg3xklzl43xas4o.dkim.amazonses.com` |
| CNAME | `7h2ybu7p2cnerogfibplymxyufo5phh7._domainkey.dev-unirise` | `7h2ybu7p2cnerogfibplymxyufo5phh7.dkim.amazonses.com` |

Still to add after the load balancer exists:
| Type | Name | Target |
|---|---|---|
| CNAME | `api.dev-unirise` | the load balancer's DNS name (`...ap-south-1.elb.amazonaws.com`) |

If Hostinger rejects a trailing dot on a Target, remove it.

## 8. Gaps to close before the frontend can use the API

- The API sends **no CORS headers**. The dev website `https://dev-unirise.mentoredge.co.in` calling `https://api.dev-unirise.mentoredge.co.in` will be blocked by the browser until CORS allows that one origin.
- The frontend still runs on mock data; switch it feature by feature (`VITE_USE_MOCK=false` and an API base URL).
- Tenant database passwords still live in a control-plane table (dev shortcut); move them to Secrets Manager before real data.
- Invitations are returned to the admin, not emailed; wire SES. Ask AWS to move SES out of the sandbox before real users get mail.
- Sign-in is API key or invitation only; OIDC is next.

## 9. Checks

Certificate and SES:
```bash
ARN=$(aws acm list-certificates --region ap-south-1 --query "CertificateSummaryList[?DomainName=='api.dev-unirise.mentoredge.co.in'].CertificateArn" --output text); aws acm describe-certificate --region ap-south-1 --certificate-arn $ARN --query 'Certificate.Status' --output text; aws sesv2 get-email-identity --region ap-south-1 --email-identity dev-unirise.mentoredge.co.in --query '{verified:VerifiedForSendingStatus,dkim:DkimAttributes.Status}'
```
Done means:
- `aws sts get-caller-identity` shows your IAM admin, not root.
- `tofu plan` in `infra/envs/dev` shows no changes.
- A `demo` institution is provisioned on dev RDS and a report returns data.
- The restore drill prints `restore drill OK`.
- After stage E: `curl https://api.dev-unirise.mentoredge.co.in/actuator/health` returns `UP`.

## 10. Cost, teardown, troubleshooting

- Stage A about US$20 to 40 a month (RDS and bastion dominate); stage E adds about US$30 to 45. The budget emails you at 80% and at a 100% forecast. Cost-allocation tags take up to 24 hours to show in billing.
- Stop spending: `tofu destroy` in `infra/envs/dev` (the database keeps a final snapshot `unirise-dev-final`; delete it by hand if not wanted). The state bucket in `infra/bootstrap` is cheap; leave it.
- "Domain not found" in Hostinger: you are in the wrong zone; see section 7.
- Certificate stuck `PENDING_VALIDATION`: confirm the record resolves with `dig +short CNAME _356c950350455a94c758ba98023804fa.api.dev-unirise.mentoredge.co.in`, then wait up to an hour.
- API fails to connect to RDS with an SSL error: set `TENANT_DB_JDBC_PARAMS=sslmode=require` and add `?sslmode=require` to `CONTROL_DB_URL`.
- Tunnel will not open: check the Session Manager plugin is installed and that you are signed in as the admin or a developer (MFA done).
