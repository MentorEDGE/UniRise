resource "aws_security_group" "db_admin" {
  name        = "${local.name}-db-admin"
  description = "Temporary database administration tasks; no inbound ports."
  vpc_id      = aws_vpc.main.id
}

resource "aws_vpc_security_group_egress_rule" "admin_https" {
  security_group_id = aws_security_group.db_admin.id
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
}

resource "aws_vpc_security_group_egress_rule" "admin_to_db" {
  security_group_id            = aws_security_group.db_admin.id
  referenced_security_group_id = aws_security_group.db.id
  ip_protocol                  = "tcp"
  from_port                    = 5432
  to_port                      = 5432
}

resource "aws_vpc_security_group_ingress_rule" "db_from_admin" {
  security_group_id            = aws_security_group.db.id
  referenced_security_group_id = aws_security_group.db_admin.id
  ip_protocol                  = "tcp"
  from_port                    = 5432
  to_port                      = 5432
}

resource "aws_iam_role" "admin_execution" {
  name               = "${local.name}-db-admin-execution"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume.json
}

resource "aws_iam_role_policy" "admin_execution" {
  name = "${local.name}-db-admin-execution"
  role = aws_iam_role.admin_execution.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      { Effect = "Allow", Action = ["ecr:GetAuthorizationToken"], Resource = "*" },
      {
        Effect   = "Allow"
        Action   = ["ecr:BatchCheckLayerAvailability", "ecr:BatchGetImage", "ecr:GetDownloadUrlForLayer"]
        Resource = aws_ecr_repository.backend.arn
      },
      {
        Effect   = "Allow"
        Action   = ["logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "${aws_cloudwatch_log_group.app.arn}:*"
      },
      {
        Effect   = "Allow"
        Action   = ["secretsmanager:GetSecretValue"]
        Resource = [aws_db_instance.main.master_user_secret[0].secret_arn, data.aws_secretsmanager_secret.app_db.arn]
      }
    ]
  })
}

resource "aws_iam_role" "db_admin" {
  name               = "${local.name}-db-admin"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume.json
}

resource "aws_iam_role_policy" "db_admin" {
  name = "${local.name}-db-admin-backups"
  role = aws_iam_role.db_admin.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["s3:GetObject", "s3:PutObject", "s3:AbortMultipartUpload"]
      Resource = "${aws_s3_bucket.b["exports"].arn}/backups/*"
    }]
  })
}

resource "aws_ecs_task_definition" "db_admin" {
  family                   = "${local.name}-db-admin"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = "256"
  memory                   = "512"
  execution_role_arn       = aws_iam_role.admin_execution.arn
  task_role_arn            = aws_iam_role.db_admin.arn
  runtime_platform {
    cpu_architecture        = "ARM64"
    operating_system_family = "LINUX"
  }
  container_definitions = jsonencode([{
    name      = "admin"
    image     = "${aws_ecr_repository.backend.repository_url}@${var.db_admin_image_digest}"
    essential = true
    environment = [for name, value in {
      PGHOST             = aws_db_instance.main.address
      PGPORT             = "5432"
      PGDATABASE         = "unirise"
      PGUSER             = "unirise_admin"
      PGSSLMODE          = "require"
      AWS_DEFAULT_REGION = var.region
      BACKUP_S3_URI      = "s3://${aws_s3_bucket.b["exports"].bucket}/backups"
    } : { name = name, value = value }]
    secrets = [
      { name = "PGPASSWORD", valueFrom = "${aws_db_instance.main.master_user_secret[0].secret_arn}:password::" },
      { name = "APP_DB_PASSWORD", valueFrom = data.aws_secretsmanager_secret.app_db.arn }
    ]
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        awslogs-group         = aws_cloudwatch_log_group.app.name
        awslogs-region        = var.region
        awslogs-stream-prefix = "admin"
      }
    }
  }])
  depends_on = [aws_iam_role_policy.admin_execution, aws_iam_role_policy.db_admin]
}

output "db_admin_task_definition" { value = aws_ecs_task_definition.db_admin.arn }
output "db_admin_security_group" { value = aws_security_group.db_admin.id }
output "task_subnets" { value = aws_subnet.public[*].id }
output "region" { value = var.region }
