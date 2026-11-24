# IAM Access Analyzer (2026-11-24, free): continuously checks the account for anything shared outside it (buckets,
# roles, keys, secrets…) and lists findings in the IAM console. Read-only: it changes nothing.
resource "aws_accessanalyzer_analyzer" "external" {
  analyzer_name = "${local.name}-external-access"
  type          = "ACCOUNT"
}
