# Alerts (BACKEND_PLAN A8): one SNS topic emails var.alert_email (AWS sends it a confirmation link once). The dev
# database was down for 11 days unnoticed in November 2026; these would have caught it within minutes.

resource "aws_sns_topic" "alerts" {
  count = var.alert_email != "" ? 1 : 0
  name  = "${local.name}-alerts"
}

resource "aws_sns_topic_subscription" "alerts_email" {
  count     = var.alert_email != "" ? 1 : 0
  topic_arn = aws_sns_topic.alerts[0].arn
  protocol  = "email"
  endpoint  = var.alert_email
}

# CloudWatch alarms and the EventBridge rule below may publish to the topic; nothing else.
resource "aws_sns_topic_policy" "alerts" {
  count = var.alert_email != "" ? 1 : 0
  arn   = aws_sns_topic.alerts[0].arn
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "CloudWatchAlarms"
        Effect    = "Allow"
        Principal = { Service = "cloudwatch.amazonaws.com" }
        Action    = "sns:Publish"
        Resource  = aws_sns_topic.alerts[0].arn
        Condition = { StringEquals = { "aws:SourceAccount" = local.account_id } }
      },
      {
        Sid       = "FailedBackupEvents"
        Effect    = "Allow"
        Principal = { Service = "events.amazonaws.com" }
        Action    = "sns:Publish"
        Resource  = aws_sns_topic.alerts[0].arn
        Condition = { ArnEquals = { "aws:SourceArn" = aws_cloudwatch_event_rule.backup_failed[0].arn } }
      },
    ]
  })
}

locals {
  alarm_actions = var.alert_email != "" ? [aws_sns_topic.alerts[0].arn] : []
}

# The API answers nobody: no healthy task behind the load balancer for 3 minutes (the health check includes the database).
resource "aws_cloudwatch_metric_alarm" "api_down" {
  count               = var.alert_email != "" ? 1 : 0
  alarm_name          = "${local.name}-api-down"
  alarm_description   = "UniRise dev: the API has no healthy server (it cannot answer, or cannot reach its database)."
  namespace           = "AWS/ApplicationELB"
  metric_name         = "HealthyHostCount"
  dimensions          = { LoadBalancer = aws_lb.api.arn_suffix, TargetGroup = aws_lb_target_group.api.arn_suffix }
  statistic           = "Minimum"
  period              = 60
  evaluation_periods  = 3
  comparison_operator = "LessThanThreshold"
  threshold           = 1
  treat_missing_data  = "breaching"
  alarm_actions       = local.alarm_actions
  ok_actions          = local.alarm_actions
}

# Server errors: more than 10 answers of 5xx from the API in 5 minutes.
resource "aws_cloudwatch_metric_alarm" "api_errors" {
  count               = var.alert_email != "" ? 1 : 0
  alarm_name          = "${local.name}-api-errors"
  alarm_description   = "UniRise dev: the API answered with server errors (5xx) more than 10 times in 5 minutes."
  namespace           = "AWS/ApplicationELB"
  metric_name         = "HTTPCode_Target_5XX_Count"
  dimensions          = { LoadBalancer = aws_lb.api.arn_suffix, TargetGroup = aws_lb_target_group.api.arn_suffix }
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  comparison_operator = "GreaterThanThreshold"
  threshold           = 10
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.alarm_actions
}

# Database storage below 2 GB.
resource "aws_cloudwatch_metric_alarm" "db_storage" {
  count               = var.alert_email != "" ? 1 : 0
  alarm_name          = "${local.name}-db-storage-low"
  alarm_description   = "UniRise dev: less than 2 GB of database storage left."
  namespace           = "AWS/RDS"
  metric_name         = "FreeStorageSpace"
  dimensions          = { DBInstanceIdentifier = aws_db_instance.main.identifier }
  statistic           = "Minimum"
  period              = 300
  evaluation_periods  = 1
  comparison_operator = "LessThanThreshold"
  threshold           = 2 * 1024 * 1024 * 1024
  treat_missing_data  = "breaching"
  alarm_actions       = local.alarm_actions
  ok_actions          = local.alarm_actions
}

# Database CPU above 80% for 15 minutes.
resource "aws_cloudwatch_metric_alarm" "db_cpu" {
  count               = var.alert_email != "" ? 1 : 0
  alarm_name          = "${local.name}-db-cpu-high"
  alarm_description   = "UniRise dev: database CPU above 80% for 15 minutes."
  namespace           = "AWS/RDS"
  metric_name         = "CPUUtilization"
  dimensions          = { DBInstanceIdentifier = aws_db_instance.main.identifier }
  statistic           = "Average"
  period              = 300
  evaluation_periods  = 3
  comparison_operator = "GreaterThanThreshold"
  threshold           = 80
  treat_missing_data  = "notBreaching"
  alarm_actions       = local.alarm_actions
  ok_actions          = local.alarm_actions
}

# A database admin job (nightly backup-all, or one started by hand) ended with an error.
resource "aws_cloudwatch_event_rule" "backup_failed" {
  count       = var.alert_email != "" ? 1 : 0
  name        = "${local.name}-db-job-failed"
  description = "UniRise dev: a database admin job (for example the nightly backup) ended with an error."
  event_pattern = jsonencode({
    source      = ["aws.ecs"]
    detail-type = ["ECS Task State Change"]
    detail = {
      clusterArn = [aws_ecs_cluster.main.arn]
      group      = ["family:${aws_ecs_task_definition.db_admin.family}"]
      lastStatus = ["STOPPED"]
      containers = { exitCode = [{ "anything-but" = 0 }] }
    }
  })
}

resource "aws_cloudwatch_event_target" "backup_failed" {
  count     = var.alert_email != "" ? 1 : 0
  rule      = aws_cloudwatch_event_rule.backup_failed[0].name
  target_id = "email-the-team"
  arn       = aws_sns_topic.alerts[0].arn
  input_transformer {
    input_paths    = { task = "$.detail.taskArn", reason = "$.detail.stoppedReason", started = "$.detail.startedAt" }
    input_template = "\"UniRise dev: a database admin job (such as the nightly backup) failed. Started <started>; task <task>; reason: <reason>. Its log is in CloudWatch, log group /unirise/dev/app, stream prefix admin/.\""
  }
}
