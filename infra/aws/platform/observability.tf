# CloudWatch Transaction Search (decision 38): X-Ray sends every span to CloudWatch Logs (aws/spans),
# where AgentCore Observability shows each claim's trace and online Evaluations read it. One setting
# per account and region, so it's the platform's.
data "aws_partition" "current" {}
data "aws_caller_identity" "current" {}

resource "aws_cloudwatch_log_resource_policy" "spans" {
  policy_name = "${local.prefix}-transaction-search"
  policy_document = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "XRayWritesSpans"
      Effect    = "Allow"
      Principal = { Service = "xray.amazonaws.com" }
      Action    = "logs:PutLogEvents"
      Resource = [
        "arn:${data.aws_partition.current.partition}:logs:${var.region}:${data.aws_caller_identity.current.account_id}:log-group:aws/spans:*",
        "arn:${data.aws_partition.current.partition}:logs:${var.region}:${data.aws_caller_identity.current.account_id}:log-group:/aws/application-signals/data:*",
      ]
      Condition = {
        ArnLike      = { "aws:SourceArn" = "arn:${data.aws_partition.current.partition}:xray:${var.region}:${data.aws_caller_identity.current.account_id}:*" }
        StringEquals = { "aws:SourceAccount" = data.aws_caller_identity.current.account_id }
      }
    }]
  })
}

resource "aws_xray_trace_segment_destination" "logs" {
  destination = "CloudWatchLogs"
  depends_on  = [aws_cloudwatch_log_resource_policy.spans]
}
