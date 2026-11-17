# Nightly backups (BACKEND_PLAN A5): EventBridge Scheduler starts the operator-only admin task with "backup-all" every
# night at 03:00 India time. It dumps every live institution's database to the exports bucket (backups/<slug>/,
# encrypted, kept 30 days by the bucket's lifecycle rule). Runs and failures are in the log group (stream prefix admin/).

resource "aws_iam_role" "backup_scheduler" {
  name = "${local.name}-backup-scheduler"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "scheduler.amazonaws.com" }
      Action    = "sts:AssumeRole"
      Condition = { StringEquals = { "aws:SourceAccount" = local.account_id } }
    }]
  })
}

# May start the admin task in the UniRise cluster only, and hand it its two roles.
resource "aws_iam_role_policy" "backup_scheduler" {
  name = "${local.name}-backup-scheduler"
  role = aws_iam_role.backup_scheduler.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect    = "Allow"
        Action    = "ecs:RunTask"
        Resource  = "${aws_ecs_task_definition.db_admin.arn_without_revision}:*"
        Condition = { ArnEquals = { "ecs:cluster" = aws_ecs_cluster.main.arn } }
      },
      {
        Effect    = "Allow"
        Action    = "iam:PassRole"
        Resource  = [aws_iam_role.admin_execution.arn, aws_iam_role.db_admin.arn]
        Condition = { StringEquals = { "iam:PassedToService" = "ecs-tasks.amazonaws.com" } }
      },
    ]
  })
}

resource "aws_scheduler_schedule" "nightly_backup" {
  name                         = "${local.name}-nightly-backup"
  description                  = "UniRise: back up every institution's database at 03:00 IST (backup-all)"
  schedule_expression          = "cron(0 3 * * ? *)"
  schedule_expression_timezone = "Asia/Kolkata"

  flexible_time_window { mode = "OFF" }

  target {
    arn      = aws_ecs_cluster.main.arn
    role_arn = aws_iam_role.backup_scheduler.arn
    input    = jsonencode({ containerOverrides = [{ name = "admin", command = ["backup-all"] }] })

    ecs_parameters {
      task_definition_arn = aws_ecs_task_definition.db_admin.arn
      launch_type         = "FARGATE"
      platform_version    = "1.4.0"
      task_count          = 1
      network_configuration {
        subnets          = aws_subnet.public[*].id
        security_groups  = [aws_security_group.db_admin.id]
        assign_public_ip = true # no NAT in dev: the task reaches S3 and Secrets Manager over its public IP; no inbound ports
      }
    }

    retry_policy {
      maximum_retry_attempts       = 2
      maximum_event_age_in_seconds = 3600
    }
  }

  depends_on = [aws_iam_role_policy.backup_scheduler]
}
