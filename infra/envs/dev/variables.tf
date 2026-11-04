variable "region" {
  type    = string
  default = "ap-south-1"
}

variable "vpc_cidr" {
  type    = string
  default = "10.20.0.0/16"
}

variable "db_instance_class" {
  type    = string
  default = "db.t4g.micro"
}

variable "db_allocated_storage" {
  type    = number
  default = 20
}

variable "enable_bastion" {
  description = "A tiny EC2 instance reachable only through SSM, used to reach the private database from a laptop."
  type        = bool
  default     = true
}

variable "ses_sender_email" {
  description = "Address UniRise sends mail from while there is no domain. Must be one you can open. Empty skips SES."
  type        = string
  default     = ""
}

variable "budget_email" {
  description = "Where cost alerts go. Empty skips the budget."
  type        = string
  default     = ""
}

variable "monthly_budget_usd" {
  type    = number
  default = 50
}

variable "developers" {
  description = "IAM user names for developers (sign-in emails)."
  type        = list(string)
  default     = []
}

variable "admins" {
  description = "IAM user names for admins. They get AdministratorAccess to the WHOLE account, which is shared with other projects."
  type        = list(string)
  default     = []
}

variable "developer_db_user" {
  description = "PostgreSQL user developers sign in as with IAM authentication. Created once by an admin (see infra/README.md); it is NOT the master user."
  type        = string
  default     = "unirise_dev"
}

variable "api_host" {
  description = "Host name of the API, Empty means api.<domain_name>; keep the default."
  type        = string
  default     = ""
}

variable "domain_name" {
  description = "Dev subdomain, for example dev-unirise.mentoredge.co.in (the dev website). DNS stays in Hostinger: Terraform prints the records to add (output dns_records). Empty skips certificate and SES domain."
  type        = string
  default     = ""
  validation {
    condition     = var.domain_name == "" || can(regex("^([a-z0-9-]+\\.)+[a-z]{2,}$", var.domain_name))
    error_message = "domain_name must be a lower-case host name such as dev-unirise.mentoredge.co.in."
  }
}
