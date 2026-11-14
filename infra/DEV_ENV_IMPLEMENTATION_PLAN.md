# UniRise dev environment implementation plan

Updated 2026-11-04. Branch `dev`. AWS account `417441726165`, region `ap-south-1` (Mumbai), shared with MentorEDGE.

Deployment is complete for the dev backend. Public health: https://api.dev-unirise.mentoredge.co.in/actuator/health returns `UP`. ECS has one running task, no pending tasks and a completed rollout. The live demo/report and S3 backup/restore checks passed; the final OpenTofu plan has no changes.

## Accepted design

The user asked to implement the cheaper Fargate design. This replaces the earlier bastion/private-endpoint plan.

| Part | Dev setup |
|---|---|
| API | One ARM64 Fargate task, 0.25 vCPU / 512 MiB, with a public IP for outbound HTTPS |
| Incoming traffic | HTTPS application load balancer; the API accepts port 8080 only from its security group |
| Database | Existing private, encrypted PostgreSQL 16 RDS; accessible only from API/admin security groups on 5432 |
| Database administration | Temporary operator-started Fargate tasks with no inbound ports, separate IAM roles and secret injection |
| AWS service access | HTTPS through the existing internet gateway, plus the free S3 gateway endpoint |
| Omitted resources | No EC2 bastion, NAT gateway or paid interface endpoints |

The backend and administration images are pinned by digest. Admin tasks can read the RDS master secret through their execution role; the normal application execution role cannot. Developer IAM users do not gain privileged admin-task access.

## Current state

- [x] `dev` includes local `main` and fetched `origin/main`, at `9717fb9`, 11 commits ahead of `origin/dev`.
- [x] Base VPC, subnets, private RDS, S3 buckets, ECR, log group, issued API certificate and verified SES domain exist.
- [x] The two manual app secrets exist in Secrets Manager. No secret values entered Terraform or the repository.
- [x] The backend image with dev-site CORS is pushed; all 36 backend tests passed.
- [x] Removed bastion and interface-endpoint definitions from the proposed configuration; updated callers, IAM permissions, outputs, examples and docs.
- [x] Added a PostgreSQL 16 admin image, an operator CLI helper and a separate Fargate task definition/network/roles.
- [x] Admin image checks passed: non-superuser bootstrap, repeated bootstrap, app password login, role permissions/database ownership, and a real PostgreSQL backup/restore.
- [x] Admin image pushed to the existing ECR repository; both images are pinned in the git-ignored tfvars file.
- [x] OpenTofu formatting/validation and plan safety assertions passed.
- [x] User explicitly approved and deployed the revised plan: 31 resources added, 0 changed, 8 unused bastion resources removed.
- [x] Live Fargate bootstrap completed, without exposing credentials.
- [x] ECS reached steady state, with one API task running and a healthy ALB target.
- [x] The user added the Hostinger CNAME; public DNS, valid-certificate HTTPS and HTTP redirect passed.
- [x] The `demo` institution, researcher/session flow, publication submission/approval and report passed. The report returned `[[2026, 1]]`.
- [x] Live backup upload and restore drill passed. S3 confirmed AES256 encryption on the 68,685-byte dump.
- [x] Final public CORS/auth/session checks and the final no-drift OpenTofu plan passed.

The failed bastion launch created no VM. Its old EC2 quota case no longer blocks this design. Some unused bastion IAM/security-group/SSM resources were created by the earlier partial apply; this plan removes them. Database login setup, live demo/report, AWS backup upload and the live restore drill are now verified.

Root remains in use temporarily. Human IAM users/MFA setup and budget alerts remain deferred as requested. No Git commit or push is authorised.

## Cost estimate

Mumbai on-demand rates checked through the AWS Price List API on 2026-11-04; 730 hours/month:

| Item | Monthly baseline, USD |
|---|---:|
| ARM64 Fargate API task (0.25 vCPU / 0.5 GiB) | $5.30 |
| API task public IPv4 address | $3.65 |
| HTTPS load balancer hourly charge | $17.45 |
| Minimum two ALB public IPv4 addresses | $7.30 |
| New API/load balancer baseline | $33.70 |
| Existing RDS db.t4g.micro compute | $15.33 |
| Paid interface endpoints / NAT / EC2 bastion | $0.00 |

Allow for RDS storage, secrets, ECR/S3, logs, ALB capacity units, data transfer, temporary admin jobs and tax. The expected dev total is roughly **$50–70/month before tax and variable usage**. Admin tasks incur compute/IP charges only while running; they do not run continuously. Already-created resources incur charges while deployment is pending. Budget alerts are disabled and there is no spending cap.

The previous $130–150 estimate included about $75.92/month of interface endpoints and a projected bastion cost; those are excluded from the new design. These endpoints and the bastion VM were never created, so this avoids planned charges rather than removing an existing endpoint/VM bill.

Sources: [Fargate pricing](https://aws.amazon.com/fargate/pricing/), [ALB pricing](https://aws.amazon.com/elasticloadbalancing/pricing/) and [VPC IPv4 pricing](https://aws.amazon.com/vpc/pricing/). Rates used: ARM CPU $0.02383/hour, memory $0.00261/GiB-hour, ALB $0.0239/hour, IPv4 $0.005/address-hour, RDS compute $0.021/hour.

## Approved and applied Terraform plan

**31 additions, 0 changes, 8 deletions. No resource replacements.**

Safety checks verified that RDS, its existing security group and all S3 resources are unchanged. Only the eight retired bastion-related resources below are deleted. No database, bucket, EC2 instance or unrelated resource is deleted. Both Fargate images are ARM64 with the expected resource limits, secret ARNs and TLS configuration. API ingress is ALB-only; the admin security group has no ingress.

### Additions

```text
aws_ecs_cluster.main
aws_ecs_service.api
aws_ecs_task_definition.api
aws_ecs_task_definition.db_admin
aws_iam_group_policy_attachment.developer_main
aws_iam_policy.developer
aws_iam_role.admin_execution
aws_iam_role.db_admin
aws_iam_role.execution
aws_iam_role.task
aws_iam_role_policy.admin_execution
aws_iam_role_policy.db_admin
aws_iam_role_policy.execution
aws_iam_role_policy.task
aws_lb.api
aws_lb_listener.http
aws_lb_listener.https
aws_lb_target_group.api
aws_security_group.alb
aws_security_group.db_admin
aws_security_group.task
aws_vpc_security_group_egress_rule.admin_https
aws_vpc_security_group_egress_rule.admin_to_db
aws_vpc_security_group_egress_rule.alb_to_task
aws_vpc_security_group_egress_rule.task_https
aws_vpc_security_group_egress_rule.task_to_db
aws_vpc_security_group_ingress_rule.alb_web["http"]
aws_vpc_security_group_ingress_rule.alb_web["https"]
aws_vpc_security_group_ingress_rule.db_from_admin
aws_vpc_security_group_ingress_rule.db_from_task
aws_vpc_security_group_ingress_rule.task_from_alb
```

### Deletions: unused bastion resources

```text
aws_iam_instance_profile.bastion[0]
aws_iam_role.bastion[0]
aws_iam_role_policy_attachment.bastion_ssm[0]
aws_security_group.bastion
aws_ssm_document.db_tunnel
aws_vpc_security_group_egress_rule.bastion_https
aws_vpc_security_group_egress_rule.bastion_to_db
aws_vpc_security_group_ingress_rule.db_from_bastion
```

Saved artifacts, which may expire:

- Binary: `/private/tmp/unirise-dev-budget.tfplan`
- Full readable plan: `/private/tmp/unirise-dev-budget-plan.txt`
- JSON: `/private/tmp/unirise-dev-budget-plan.json`
- Resource summary: `/private/tmp/unirise-dev-budget-resources.txt`

The earlier `unirise-dev-stage-e.tfplan` is superseded and must not be applied. Regenerate and compare a plan if configuration or state changes.

## Verified deployment

- Approved plan applied: 31 additions, 0 changes, 8 retired bastion-resource deletions. No RDS/S3 replacement or unrelated changes.
- `scripts/run-db-admin.sh bootstrap` returned `database bootstrap OK` and exit code 0.
- ECS service `unirise-dev-api` in cluster `unirise-dev` is ACTIVE with desired/running count 1, pending count 0, one deployment and rollout COMPLETED.
- The user added CNAME `api.dev-unirise` -> `unirise-dev-api-2002016511.ap-south-1.elb.amazonaws.com` in the `mentoredge.co.in` zone. DNS resolution and certificate verification passed; HTTP redirects to HTTPS.
- `https://api.dev-unirise.mentoredge.co.in/actuator/health` returns `UP`.
- Demo provisioning, a researcher, invitation/session, publication submission/approval and an authenticated report passed. The report has columns `Year, Publications` and row `[2026, 1]`. The session and report still work after the API rollout.
- Allowed-origin preflight succeeds, an allowed-origin request without credentials returns 401 with CORS headers, and an untrusted origin returns 403.
- `scripts/run-db-admin.sh backup-restore demo` returned `restore drill OK for demo` and exit code 0. The 68,685-byte dump is at `s3://unirise-dev-exports-417441726165/backups/demo/tenant_demo-20261104T110208Z.dump`, encrypted with AES256. Existing lifecycle expiry is 30 days.
- Final OpenTofu plan reports no changes. There are 71 managed resources in the dev stack; no bastion, EC2 instance or paid interface endpoint remains in that stack.

For future image updates or backup operations, use [DEV_DEPLOY_RUNBOOK.md](DEV_DEPLOY_RUNBOOK.md). Do not reprovision the existing demo blindly. Its one-time test credentials were held in memory for verification and were not saved or exposed; use a separate institution for new credential-based tests. No Git commit or push was made.

## Application work still separate

CORS is implemented but becomes live only after deployment. `unirise-web` was superseded and removed (2026-11-14); `rdms-web`, the product frontend, has its own Node/SQLite backend. Selecting and connecting a frontend requires API/authentication contract work. Tenant credential storage outside the control-plane table, SES invitation delivery/sandbox exit and OIDC remain product gaps. Never put operator or tenant service keys in browser build variables.

The dev backend deployment is verified. These separate frontend/product gaps are not marked complete by the infrastructure deployment.
