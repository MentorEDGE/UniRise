output "rds_endpoint" { value = aws_db_instance.main.address }
output "rds_secret_arn" { value = aws_db_instance.main.master_user_secret[0].secret_arn }
# Add these in the Hostinger DNS panel (names are full host names; drop the zone suffix if the panel adds it for you).
output "dns_records" {
  value = local.domain_on ? concat(
    [for o in aws_acm_certificate.api[0].domain_validation_options : { type = o.resource_record_type, name = o.resource_record_name, value = o.resource_record_value, purpose = "certificate validation" }],
    [for t in aws_sesv2_email_identity.domain[0].dkim_signing_attributes[0].tokens : { type = "CNAME", name = "${t}._domainkey.${var.domain_name}", value = "${t}.dkim.amazonses.com", purpose = "SES DKIM" }]
  ) : []
}

output "bucket_names" { value = { for k, b in aws_s3_bucket.b : k => b.bucket } }
output "ecr_repository_url" { value = aws_ecr_repository.backend.repository_url }
output "log_group" { value = aws_cloudwatch_log_group.app.name }
output "ses_sender" { value = local.email_on ? aws_sesv2_email_identity.sender[0].email_identity : null }
