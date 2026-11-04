provider "aws" {
  region = var.region
  default_tags {
    tags = { Project = "UniRise", Environment = "dev", ManagedBy = "terraform" }
  }
}

data "aws_caller_identity" "current" {}
data "aws_availability_zones" "available" { state = "available" }

locals {
  name       = "unirise-dev"
  account_id = data.aws_caller_identity.current.account_id
  azs        = slice(data.aws_availability_zones.available.names, 0, 2)
  email_on   = var.ses_sender_email != ""
  domain_on  = var.domain_name != ""
  ses_on     = local.email_on || local.domain_on
}
