# UniRise dev infrastructure

The current dev design uses ARM64 ECS Fargate, private PostgreSQL 16 RDS, S3, SES and an HTTPS application load balancer in AWS account `417441726165`, Mumbai (`ap-south-1`). It shares the account with MentorEDGE; only UniRise resources are in scope.

Fargate tasks get public IPs for outbound HTTPS. The API accepts inbound traffic only from its load balancer on port 8080. RDS stays in private subnets, reachable only from the API and separate admin task security groups on 5432. Temporary admin tasks have no inbound ports. There is no EC2 bastion, NAT gateway or paid interface endpoint. The free S3 gateway endpoint remains.

## Files and services

| File | Purpose |
|---|---|
| `bootstrap/` | Existing encrypted Terraform state bucket |
| `envs/dev/network.tf` | VPC, two public/two private subnets, routing, S3 gateway endpoint, existing database security group |
| `envs/dev/rds.tf` | Private encrypted db.t4g.micro, 20 GB gp3, seven-day RDS backups, IAM DB authentication, RDS-managed master secret |
| `envs/dev/ecs.tf` | One ARM64 Fargate API task, ALB/TLS, application roles and security rules |
| `envs/dev/db-admin.tf` | Operator-only task definition, separate execution role for secret injection, backup-prefix S3 role and network rules |
| `envs/dev/s3.tf` | Private uploads and exports buckets, encryption/TLS enforcement, lifecycle policies |
| `envs/dev/registry.tf` | ECR repository and 14-day application log group |
| `envs/dev/domain.tf`, `ses.tf` | Issued ACM certificate, verified SES domain, configuration set; DNS stays in Hostinger |
| `envs/dev/iam.tf` | Developer/admin groups, MFA policy, scoped developer data/ECR/log permissions |
| `envs/dev/budget.tf` | Optional budget; account-wide cost tag activation also stays disabled when no budget email is set |

The full dev backend is deployed and verified. The approved apply added 31 resources and removed 8 unused bastion resources; no bastion VM was created. Public health at https://api.dev-unirise.mentoredge.co.in/actuator/health returns `UP`. ECS is stable with one task, the demo report and encrypted S3 backup/restore passed, and the final OpenTofu plan has no changes. The earlier EC2 quota request no longer affects this design.

## Deployment

Use [DEV_DEPLOY_RUNBOOK.md](DEV_DEPLOY_RUNBOOK.md) for commands and [DEV_ENV_IMPLEMENTATION_PLAN.md](DEV_ENV_IMPLEMENTATION_PLAN.md) for the current plan and costs. The two manually created Secrets Manager secrets must exist before planning: `unirise/dev/app-db` and `unirise/dev/admin-key`. Terraform reads only secret metadata. Image digests are required in the git-ignored tfvars file; build/push the API and admin images with `scripts/push-image.sh` and `scripts/push-image.sh db-admin`.

After applying an approved plan, run `scripts/run-db-admin.sh bootstrap`, force a new API deployment, verify healthy targets and provision a synthetic demo tenant. Run `scripts/run-db-admin.sh backup-restore demo` to upload a backup and test its restore. Both admin jobs run only on demand. The helper requires AWS CLI, OpenTofu, Python 3 and operator permissions to run the task/pass its roles. Developer IAM users cannot launch these privileged tasks by default.

The admin image's check is `scripts/db-admin/check.sh` after building it as `unirise-db-admin:check`; it uses disposable local Docker resources and no AWS credentials. It verifies non-superuser setup, repeat execution, credentials and PostgreSQL 16 backup/restore.

## Cost and limits

Estimate $50–70/month before tax and variable usage, including RDS, one API task and the HTTPS load balancer. The API/ALB/public-IP baseline adds about $33.70/month; temporary admin tasks add only running-time charges. Budget alerts and human IAM users remain disabled/deferred at the user's request. Root is a temporary task override, not the intended production operating identity.

RDS has no Multi-AZ or deletion protection in dev; a final snapshot is required on destruction. Keep real researcher data out of dev. Tenant database passwords remain in a control-plane table until the application moves them to Secrets Manager. Exports/backup objects expire after 30 days. Manual restore jobs are not scheduled backups. No deploy pipeline or frontend contract migration is included.
