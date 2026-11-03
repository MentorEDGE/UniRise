output "rds_endpoint" { value = aws_db_instance.main.address }
output "rds_secret_arn" { value = aws_db_instance.main.master_user_secret[0].secret_arn }
output "bucket_names" { value = { for k, b in aws_s3_bucket.b : k => b.bucket } }
output "ecr_repository_url" { value = aws_ecr_repository.backend.repository_url }
output "log_group" { value = aws_cloudwatch_log_group.app.name }
output "ses_sender" { value = aws_sesv2_email_identity.sender.email_identity }
output "bastion_instance_id" { value = var.enable_bastion ? aws_instance.bastion[0].id : null }

# Run this on your laptop (needs the AWS CLI and the Session Manager plugin), then connect to localhost:15432.
output "db_tunnel_command" {
  value = var.enable_bastion ? "aws ssm start-session --region ${var.region} --target ${aws_instance.bastion[0].id} --document-name AWS-StartPortForwardingSessionToRemoteHost --parameters host=${aws_db_instance.main.address},portNumber=5432,localPortNumber=15432" : null
}
