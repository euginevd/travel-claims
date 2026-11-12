# Free-tier monitoring of the app (decision 30): alarms on its functions, emailed through one topic.
# Bedrock model invocation logging is in model_logs.tf; the account's budget and Access Analyzer are the
# platform team's (decision 41).
data "aws_caller_identity" "current" {}

locals {
  account   = data.aws_caller_identity.current.account_id
  prefix    = "${var.project}-${var.environment}"
  functions = toset(["api", "context", "copilot"])
  # Six standard alarms, inside CloudWatch's ten free ones.
  alarms = { for pair in setproduct(local.functions, ["Errors", "Throttles"]) : "${pair[0]}-${lower(pair[1])}" => { function = pair[0], metric = pair[1] } }
}

# trivy:ignore:AWS-0095 an AWS-owned key is enough for alerts about made-up data
resource "aws_sns_topic" "alerts" {
  #checkov:skip=CKV_AWS_26: an AWS-owned key is enough for alerts about made-up data
  name = "${local.prefix}-alerts"
}

# CloudWatch may publish here, from this account only.
resource "aws_sns_topic_policy" "alerts" {
  arn = aws_sns_topic.alerts.arn
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "cloudwatch.amazonaws.com" }
      Action    = "sns:Publish"
      Resource  = aws_sns_topic.alerts.arn
      Condition = { StringEquals = { "aws:SourceAccount" = data.aws_caller_identity.current.account_id } }
    }]
  })
}

resource "aws_sns_topic_subscription" "email" {
  count = var.alert_email == "" ? 0 : 1

  topic_arn = aws_sns_topic.alerts.arn
  protocol  = "email"
  endpoint  = var.alert_email
}

# Errors or throttles on a function in any five minutes.
resource "aws_cloudwatch_metric_alarm" "function" {
  for_each = local.alarms

  alarm_name          = "${local.prefix}-${each.key}"
  alarm_description   = "${each.value.metric} on ${local.prefix}-${each.value.function}"
  namespace           = "AWS/Lambda"
  metric_name         = each.value.metric
  dimensions          = { FunctionName = "${local.prefix}-${each.value.function}" }
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = each.value.metric == "Errors" ? 5 : 1
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_sns_topic.alerts.arn]
}
