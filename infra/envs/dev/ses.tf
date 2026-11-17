# New SES accounts start in the sandbox: mail can only go to addresses you have verified. Ask AWS for production access
# (SES console, Account dashboard) before any real user gets a reminder. A domain identity replaces this later.
resource "aws_sesv2_configuration_set" "main" {
  count                  = local.ses_on ? 1 : 0
  configuration_set_name = "${local.name}-default"
  reputation_options { reputation_metrics_enabled = true }
  sending_options { sending_enabled = true }
  delivery_options { tls_policy = "REQUIRE" }
}

resource "aws_sesv2_email_identity" "sender" {
  count                  = local.email_on ? 1 : 0
  email_identity         = var.ses_sender_email
  configuration_set_name = aws_sesv2_configuration_set.main[0].configuration_set_name
}

# The UniRise team's address for "Talk to our team" enquiries (A1a). In the sandbox SES delivers only to verified
# addresses, so AWS emails this address a verification link once; someone there clicks it. Not needed after production access (A3).
resource "aws_sesv2_email_identity" "enquiries_to" {
  count          = local.domain_on && var.enquiries_to != "" ? 1 : 0
  email_identity = var.enquiries_to
}
