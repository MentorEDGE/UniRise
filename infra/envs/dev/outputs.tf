output "rds_endpoint" { value = aws_db_instance.main.address }
output "rds_secret_arn" { value = aws_db_instance.main.master_user_secret[0].secret_arn }
output "bucket_names" { value = { for k, b in aws_s3_bucket.b : k => b.bucket } }
output "ecr_repository_url" { value = aws_ecr_repository.backend.repository_url }
output "log_group" { value = aws_cloudwatch_log_group.app.name }
output "ses_sender" { value = aws_sesv2_email_identity.sender.email_identity }
output "bastion_instance_id" { value = var.enable_bastion ? aws_instance.bastion[0].id : null }

# 1) Open the tunnel (needs the AWS CLI and the Session Manager plugin); it listens on localhost:15432.
output "db_tunnel_command" {
  value = var.enable_bastion ? "aws ssm start-session --region ${var.region} --target ${aws_instance.bastion[0].id} --document-name ${aws_ssm_document.db_tunnel.name}" : null
}

# 2) Connect as the limited developer user with a 15-minute IAM token instead of a stored password.
output "db_connect_command" {
  value = "PGPASSWORD=$(aws rds generate-db-auth-token --region ${var.region} --hostname ${aws_db_instance.main.address} --port 5432 --username ${var.developer_db_user}) psql \"host=localhost port=15432 dbname=unirise user=${var.developer_db_user} sslmode=require\""
}
