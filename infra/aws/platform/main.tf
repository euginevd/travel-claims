# What a platform team's landing zone gives every account (decisions 35 and 36), here in one unit for
# simplicity: the budget alert, IAM Access Analyzer and the workload network (network.tf). With
# PLATFORM_MANAGED=true the pipeline skips this unit, and the platform's own settings stay untouched.

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
