data "aws_secretsmanager_secret" "app_db" {
  name = "unirise/dev/app-db"
}

data "aws_secretsmanager_secret" "admin_key" {
  name = "unirise/dev/admin-key"
}

data "aws_iam_policy_document" "ecs_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "execution" {
  name               = "${local.name}-execution"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume.json
}

resource "aws_iam_role_policy" "execution" {
  name = "${local.name}-execution"
  role = aws_iam_role.execution.id
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
        Resource = [data.aws_secretsmanager_secret.app_db.arn, data.aws_secretsmanager_secret.admin_key.arn]
      }
    ]
  })
}

resource "aws_iam_role" "task" {
  name               = "${local.name}-task"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume.json
}

data "aws_iam_policy_document" "task" {
  statement {
    actions   = ["s3:ListBucket", "s3:GetBucketLocation"]
    resources = [for b in aws_s3_bucket.b : b.arn]
  }
  statement {
    actions   = ["s3:GetObject", "s3:GetObjectTagging", "s3:PutObject", "s3:DeleteObject", "s3:AbortMultipartUpload", "s3:ListMultipartUploadParts"]
    resources = [for b in aws_s3_bucket.b : "${b.arn}/*"]
  }
  # Institution database passwords (A2): one secret per institution under this prefix, created by the API when it
  # provisions an institution. Nothing outside the prefix.
  statement {
    sid = "InstitutionDatabasePasswords"
    actions = [
      "secretsmanager:CreateSecret", "secretsmanager:GetSecretValue", "secretsmanager:PutSecretValue", "secretsmanager:DescribeSecret",
      "secretsmanager:DeleteSecret", "secretsmanager:TagResource",
    ]
    resources = ["arn:aws:secretsmanager:${var.region}:${local.account_id}:secret:${local.tenant_secret_prefix}*"]
  }
  dynamic "statement" {
    for_each = local.ses_on ? [1] : []
    content {
      actions = ["ses:SendEmail", "ses:SendRawEmail"]
      # In the SES sandbox the recipient's identity must be allowed too (the team's verified address).
      resources = concat(local.email_on ? [aws_sesv2_email_identity.sender[0].arn] : [], local.domain_on ? [aws_sesv2_email_identity.domain[0].arn] : [], [aws_sesv2_configuration_set.main[0].arn], aws_sesv2_email_identity.enquiries_to[*].arn)
    }
  }
}

resource "aws_iam_role_policy" "task" {
  name   = "${local.name}-task"
  role   = aws_iam_role.task.id
  policy = data.aws_iam_policy_document.task.json
}

resource "aws_security_group" "alb" {
  name        = "${local.name}-alb"
  description = "Public HTTPS and HTTP redirect for the UniRise API."
  vpc_id      = aws_vpc.main.id
}

resource "aws_security_group" "task" {
  name        = "${local.name}-task"
  description = "API traffic from the load balancer only."
  vpc_id      = aws_vpc.main.id
}

resource "aws_vpc_security_group_ingress_rule" "alb_web" {
  for_each          = { http = 80, https = 443 }
  security_group_id = aws_security_group.alb.id
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "tcp"
  from_port         = each.value
  to_port           = each.value
}

resource "aws_vpc_security_group_egress_rule" "alb_to_task" {
  security_group_id            = aws_security_group.alb.id
  referenced_security_group_id = aws_security_group.task.id
  ip_protocol                  = "tcp"
  from_port                    = 8080
  to_port                      = 8080
}

resource "aws_vpc_security_group_ingress_rule" "task_from_alb" {
  security_group_id            = aws_security_group.task.id
  referenced_security_group_id = aws_security_group.alb.id
  ip_protocol                  = "tcp"
  from_port                    = 8080
  to_port                      = 8080
}

resource "aws_vpc_security_group_egress_rule" "task_to_db" {
  security_group_id            = aws_security_group.task.id
  referenced_security_group_id = aws_security_group.db.id
  ip_protocol                  = "tcp"
  from_port                    = 5432
  to_port                      = 5432
}

resource "aws_vpc_security_group_ingress_rule" "db_from_task" {
  security_group_id            = aws_security_group.db.id
  referenced_security_group_id = aws_security_group.task.id
  ip_protocol                  = "tcp"
  from_port                    = 5432
  to_port                      = 5432
}

resource "aws_vpc_security_group_egress_rule" "task_https" {
  security_group_id = aws_security_group.task.id
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
}

resource "aws_lb" "api" {
  name               = "${local.name}-api"
  load_balancer_type = "application"
  subnets            = aws_subnet.public[*].id
  security_groups    = [aws_security_group.alb.id]
}

resource "aws_lb_target_group" "api" {
  name        = "${local.name}-api"
  port        = 8080
  protocol    = "HTTP"
  target_type = "ip"
  vpc_id      = aws_vpc.main.id
  health_check {
    path    = "/actuator/health"
    matcher = "200"
  }
}

resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.api.arn
  port              = 80
  protocol          = "HTTP"
  default_action {
    type = "redirect"
    redirect {
      port        = "443"
      protocol    = "HTTPS"
      status_code = "HTTP_301"
    }
  }
}

resource "aws_lb_listener" "https" {
  load_balancer_arn = aws_lb.api.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = aws_acm_certificate.api[0].arn
  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.api.arn
  }
}

resource "aws_ecs_cluster" "main" {
  name = local.name
}

resource "aws_ecs_task_definition" "api" {
  family                   = "${local.name}-api"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = "256"
  memory                   = "512"
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.task.arn
  runtime_platform {
    cpu_architecture        = "ARM64"
    operating_system_family = "LINUX"
  }
  container_definitions = jsonencode([{
    name         = "api"
    image        = "${aws_ecr_repository.backend.repository_url}@${aws_ssm_parameter.api_image.insecure_value}" # the image GitHub deployed (A4); seeded from var.api_image_digest
    essential    = true
    portMappings = [{ containerPort = 8080, protocol = "tcp" }]
    environment = [for name, value in {
      CONTROL_DB_URL        = "jdbc:postgresql://${aws_db_instance.main.address}:5432/unirise?sslmode=require"
      CONTROL_DB_USER       = "unirise_app"
      TENANT_DB_HOST        = aws_db_instance.main.address
      TENANT_DB_PORT        = "5432"
      TENANT_DB_JDBC_PARAMS = "sslmode=require"
      AWS_REGION            = var.region
      SECRETS_STORE         = "aws" # institution database passwords in Secrets Manager, not in the control-plane database (A2)
      SECRETS_PREFIX        = local.tenant_secret_prefix
      UPLOADS_BUCKET        = aws_s3_bucket.b["uploads"].bucket # record files (A1b); the task role may read and write it
      UPLOADS_MALWARE_SCAN  = "true"                            # A9: open a file only once GuardDuty has tagged it clean
      # Email (A1a): enquiries from the website go to the UniRise team, sent from the verified dev domain.
      MAIL_FROM              = local.domain_on ? "UniRise <no-reply@${var.domain_name}>" : ""
      MAIL_ENQUIRIES_TO      = var.enquiries_to
      MAIL_CONFIGURATION_SET = local.ses_on ? aws_sesv2_configuration_set.main[0].configuration_set_name : ""
    } : { name = name, value = value }]
    secrets = [
      { name = "RMS_DB_PASSWORD", valueFrom = data.aws_secretsmanager_secret.app_db.arn },
      { name = "RMS_ADMIN_KEY", valueFrom = data.aws_secretsmanager_secret.admin_key.arn }
    ]
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        awslogs-group         = aws_cloudwatch_log_group.app.name
        awslogs-region        = var.region
        awslogs-stream-prefix = "api"
      }
    }
  }])
}

resource "aws_ecs_service" "api" {
  name                              = "${local.name}-api"
  cluster                           = aws_ecs_cluster.main.id
  task_definition                   = aws_ecs_task_definition.api.arn
  desired_count                     = 1
  launch_type                       = "FARGATE"
  propagate_tags                    = "TASK_DEFINITION"
  health_check_grace_period_seconds = 120
  network_configuration {
    subnets          = aws_subnet.public[*].id
    security_groups  = [aws_security_group.task.id]
    assign_public_ip = true
  }
  load_balancer {
    target_group_arn = aws_lb_target_group.api.arn
    container_name   = "api"
    container_port   = 8080
  }
  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }
  depends_on = [aws_lb_listener.https, aws_iam_role_policy.execution, aws_iam_role_policy.task]
}

output "api_load_balancer_dns" { value = aws_lb.api.dns_name }
output "api_url" { value = "https://${local.api_host}" }
output "ecs_cluster" { value = aws_ecs_cluster.main.name }
output "ecs_service" { value = aws_ecs_service.api.name }
