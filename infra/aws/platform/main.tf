# What a platform team's landing zone gives every account (decisions 35, 36 and 38), here in one unit for
# reference: the budget alert, IAM Access Analyzer, the workload network (network.tf), backups
# (backup.tf) and Transaction Search for traces (observability.tf). A platform team already runs these,
# so the pipeline skips this unit unless DEPLOY_PLATFORM=true, for an account with no platform team (decision 40).

locals {
  prefix = "${var.project}-${var.environment}"
}

# The month's spend, actual and forecast, emailed straight to ALERT_EMAIL; Budgets without actions are free.
resource "aws_budgets_budget" "monthly" {
  name         = "${local.prefix}-monthly"
  budget_type  = "COST"
  limit_amount = tostring(var.monthly_budget)
  limit_unit   = "USD"
  time_unit    = "MONTHLY"

  dynamic "notification" {
    for_each = var.alert_email == "" ? {} : { ACTUAL = 80, FORECASTED = 100 }
    content {
      comparison_operator        = "GREATER_THAN"
      threshold                  = notification.value
      threshold_type             = "PERCENTAGE"
      notification_type          = notification.key
      subscriber_email_addresses = [var.alert_email]
    }
  }
}

# Finds anything shared outside the account, such as a public bucket or a role others can assume.
resource "aws_accessanalyzer_analyzer" "account" {
  count = var.access_analyzer ? 1 : 0

  analyzer_name = "${local.prefix}-account"
  type          = "ACCOUNT"
}
