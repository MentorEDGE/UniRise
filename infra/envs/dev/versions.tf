terraform {
  required_version = ">= 1.10"
  required_providers {
    aws = { source = "hashicorp/aws", version = ">= 5.80, < 7.0" }
  }
  # Configured at init time: terraform init -backend-config=backend.hcl (see backend.hcl.example).
  backend "s3" {}
}
