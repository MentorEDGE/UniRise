# The DNS zone for mentoredge.co.in lives in Hostinger, so Terraform cannot create records. It creates the certificate and the SES domain
# identity, and `tofu output dns_records` lists the CNAMEs to add by hand. Nothing waits for DNS: the certificate shows "Pending validation"
# until the record exists, then turns "Issued" by itself.
resource "aws_acm_certificate" "api" {
  count             = local.domain_on ? 1 : 0
  domain_name       = local.api_host
  validation_method = "DNS"
  lifecycle { create_before_destroy = true }
}

resource "aws_sesv2_email_identity" "domain" {
  count                  = local.domain_on ? 1 : 0
  email_identity         = var.domain_name
  configuration_set_name = aws_sesv2_configuration_set.main[0].configuration_set_name
}
