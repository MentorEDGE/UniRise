# The account is shared with other projects, so the budget only counts resources tagged Project=UniRise.
# Cost-allocation tags take up to 24 hours to appear in billing data.
resource "aws_ce_cost_allocation_tag" "project" {
  count   = var.budget_email != "" ? 1 : 0
  tag_key = "Project"
  status  = "Active"
}

resource "aws_budgets_budget" "monthly" {
  count        = var.budget_email != "" ? 1 : 0
  name         = "${local.name}-monthly"
  budget_type  = "COST"
  limit_amount = tostring(var.monthly_budget_usd)
  limit_unit   = "USD"
  time_unit    = "MONTHLY"

  cost_filter {
    name   = "TagKeyValue"
    values = ["user:Project$UniRise"]
  }

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 80
    threshold_type             = "PERCENTAGE"
    notification_type          = "ACTUAL"
    subscriber_email_addresses = [var.budget_email]
  }
  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 100
    threshold_type             = "PERCENTAGE"
    notification_type          = "FORECASTED"
    subscriber_email_addresses = [var.budget_email]
  }
  depends_on = [aws_ce_cost_allocation_tag.project]
}
