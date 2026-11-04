# Prompt: finish the UniRise dev environment on AWS and push the backend

Paste everything below the line into a coding agent (Claude Code or similar) opened at the repository root `UniRise/`. Fill the three values in brackets first, or tell the agent they are not decided yet.

---

You are helping me finish the **dev environment of UniRise on AWS** and get the backend running there. Work in the repository root. Read these files first, in this order, and do not skip them:

1. `infra/DEV_DEPLOY_RUNBOOK.md` — the step-by-step plan and the exact state of the account today. This is your plan.
2. `infra/README.md` — what each Terraform file creates.
3. `rms-docs/MULTI_TENANCY_DESIGN.md` — one PostgreSQL database per institution, a control-plane database, and why.
4. `unirise-api/README.md` — the API's settings and known shortcuts.
5. `rms-docs/TENANT_DB_SCHEMA.md` — the tenant database schema (for reference only).

**Facts you must not re-derive**
- AWS account `417441726165`, region `ap-south-1`, **shared with MentorEDGE**. Everything of ours is named `unirise-dev-*` and tagged `Project=UniRise`. Never touch anything else in the account.
- Already applied: the Terraform state bucket, the certificate request for `api.dev-unirise.mentoredge.co.in`, and the SES domain identity `dev-unirise.mentoredge.co.in` (verified). Everything else in `infra/envs/dev` is **not applied**.
- DNS is at **Hostinger**, in the zone `mentoredge.co.in`. `dev-unirise` is a record inside that zone, not a zone of its own. You cannot create DNS records; you give me the exact Name and Target to paste, with the Name ending in `.dev-unirise`.
- The AWS CLI may be signed in as **root**. Root is only for creating the first admin user. After that it must not be used.
- The backend is `unirise-api/` (Spring Boot 4, Java 21). Its tests need Docker (`./mvnw verify`, JDK 21 at `~/.jdks/temurin21/Contents/Home`).

**My inputs** (if blank, ask me before the step that needs them)
- Budget alert email: [ ]
- IAM admin user name: [ ]
- Developer user names (or none): [ ]

**What I want done, in order** (the runbook has the commands)
1. Stage A: fill `infra/envs/dev/terraform.tfvars`, run `tofu init`, then `tofu plan -out`. **Show me the full resource list and stop for my approval before any apply.**
2. Stage B: help me create the admin's console login and MFA, and switch the CLI off root. Verify with `aws sts get-caller-identity`.
3. Stage C: the one-time database logins `unirise_dev` and `unirise_app` and the two Secrets Manager secrets, exactly as in the runbook.
4. Stage D: push the image with `scripts/push-image.sh`, run the API against dev RDS through the SSM tunnel, provision a `demo` institution, and run the backup and restore drill. Mind the `db_host` gotcha described in the runbook.
5. Stage E: write `infra/envs/dev/ecs.tf` to the specification in the runbook (Fargate arm64, load balancer with the issued certificate, VPC endpoints because there is no NAT, database ingress from the task security group). Run `tofu validate` and `tofu plan`, show me the plan and the monthly cost estimate, and wait for approval. Then give me the one Hostinger record to add for `api.dev-unirise`.
6. Close the gaps listed in the runbook's section 8 that block the frontend, starting with CORS for `https://dev-unirise.mentoredge.co.in` (with a test).

**Rules**
- **Never apply, destroy or delete without showing me the plan and getting a clear yes in this conversation.** A previous "continue" is not approval for an apply.
- Never put a password, key or token in a file in the repo, in Terraform variables or state, in a commit, or in your replies. Fetch secrets into environment variables without printing them.
- Do not commit or push unless I ask. When I ask, commit locally first and tell me before pushing.
- Prefer the smallest change. Reuse what exists (`scripts/`, `infra/envs/dev/*.tf`, the API's settings). Do not rewrite working code.
- If a command fails, show me the real error, explain it plainly, and fix the cause; do not work around a safeguard (a denied permission, an MFA policy, a security group rule).
- Each stage ends with its "done means" check from the runbook. Report what passed, what you skipped and what you could not verify.
- Costs: tell me what each stage adds per month before I approve it.
- When the session ends, write a handoff note to `/Users/suryasriramduvvuri/Personal/AI-Brain/04_Sessions/` as my global instructions require.

Start by reading the five files, checking `aws sts get-caller-identity`, and telling me in a few lines which stage we are at and what you need from me.
