# Deploys from GitHub (BACKEND_PLAN A4). GitHub Actions in MentorEDGE/UniRise, on the dev branch only, signs in
# through the account's existing GitHub OpenID Connect provider (also used by MentorEDGE, which is not changed here)
# and gets a UniRise-only role: push the API image, roll out a new API task definition, record the deployed image.
# No stored keys. Workflow: .github/workflows/deploy-dev.yml.

data "aws_iam_openid_connect_provider" "github" {
  url = "https://token.actions.githubusercontent.com"
}

resource "aws_iam_role" "github_deploy" {
  name = "${local.name}-github-deploy"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Federated = data.aws_iam_openid_connect_provider.github.arn }
      Action    = "sts:AssumeRoleWithWebIdentity"
      Condition = {
        StringEquals = {
          "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com"
          "token.actions.githubusercontent.com:sub" = "repo:${var.github_repo}:ref:refs/heads/dev"
        }
      }
    }]
  })
}

resource "aws_iam_role_policy" "github_deploy" {
  name = "${local.name}-github-deploy"
  role = aws_iam_role.github_deploy.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      { Sid = "EcrLogin", Effect = "Allow", Action = "ecr:GetAuthorizationToken", Resource = "*" },
      {
        Sid      = "PushApiImage"
        Effect   = "Allow"
        Action   = ["ecr:BatchCheckLayerAvailability", "ecr:InitiateLayerUpload", "ecr:UploadLayerPart", "ecr:CompleteLayerUpload", "ecr:PutImage", "ecr:BatchGetImage", "ecr:DescribeImages"]
        Resource = aws_ecr_repository.backend.arn
      },
      # Task definitions cannot be limited by name when registering; reading them is harmless.
      { Sid = "TaskDefinitions", Effect = "Allow", Action = ["ecs:RegisterTaskDefinition", "ecs:DescribeTaskDefinition"], Resource = "*" },
      {
        Sid      = "RollOutTheApiService"
        Effect   = "Allow"
        Action   = ["ecs:UpdateService", "ecs:DescribeServices"]
        Resource = "arn:aws:ecs:${var.region}:${local.account_id}:service/${aws_ecs_cluster.main.name}/${local.name}-api"
      },
      {
        Sid       = "HandTheApiTaskItsRoles"
        Effect    = "Allow"
        Action    = "iam:PassRole"
        Resource  = [aws_iam_role.task.arn, aws_iam_role.execution.arn]
        Condition = { StringEquals = { "iam:PassedToService" = "ecs-tasks.amazonaws.com" } }
      },
      {
        Sid      = "RecordTheDeployedImage"
        Effect   = "Allow"
        Action   = ["ssm:GetParameter", "ssm:PutParameter"]
        Resource = aws_ssm_parameter.api_image.arn
      },
    ]
  })
}

# The API image in use. GitHub writes it after each deploy; OpenTofu reads it (and never puts back an older one), so
# a later `tofu apply` keeps the image GitHub deployed. Seeded once from var.api_image_digest.
resource "aws_ssm_parameter" "api_image" {
  name           = "/unirise/dev/api-image-digest"
  type           = "String"
  insecure_value = var.api_image_digest
  description    = "UniRise dev API image digest (sha256:...), written by the GitHub deploy"
  lifecycle { ignore_changes = [insecure_value] }
}

output "github_deploy_role" { value = aws_iam_role.github_deploy.arn }
