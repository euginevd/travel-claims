# AgentCore Evaluations online (decision 38): a sample of the agent's live sessions is scored by
# built-in judges from its traces in aws/spans (Transaction Search, platform unit), with results in
# CloudWatch beside the console's own evaluations. Off (0) unless EVALUATION_SAMPLING is set.
variable "evaluation_sampling" {
  description = "Percentage of the agent's live sessions scored online; 0 turns online evaluations off"
  type        = number
  default     = 0
  validation {
    condition     = var.evaluation_sampling >= 0 && var.evaluation_sampling <= 100
    error_message = "evaluation_sampling is a percentage, 0 to 100."
  }
}

locals {
  evaluate = var.evaluation_sampling > 0
}

resource "aws_iam_role" "evaluations" {
  count = local.evaluate ? 1 : 0

  name                 = "${local.prefix}-evaluations"
  description          = "Lets AgentCore Evaluations read the ${var.project} agent's traces and score them"
  permissions_boundary = local.boundary

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "bedrock-agentcore.amazonaws.com" }
      Action    = "sts:AssumeRole"
      Condition = {
        StringEquals = { "aws:SourceAccount" = local.account }
        ArnLike      = { "aws:SourceArn" = "arn:${local.partition}:bedrock-agentcore:${local.region}:${local.account}:*" }
      }
    }]
  })
}

resource "aws_iam_role_policy" "evaluations" {
  count = local.evaluate ? 1 : 0

  name = "evaluations"
  role = aws_iam_role.evaluations[0].id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      # The agent's spans and runtime logs.
      {
        Effect = "Allow"
        Action = ["logs:DescribeLogGroups", "logs:FilterLogEvents", "logs:GetLogEvents", "logs:StartQuery", "logs:GetQueryResults", "logs:StopQuery"]
        Resource = [
          "arn:${local.partition}:logs:${local.region}:${local.account}:log-group:aws/spans:*",
          "arn:${local.partition}:logs:${local.region}:${local.account}:log-group:/aws/bedrock-agentcore/*",
        ]
      },
      # Results and scores.
      {
        Effect   = "Allow"
        Action   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "arn:${local.partition}:logs:${local.region}:${local.account}:log-group:/aws/bedrock-agentcore/*"
      },
      # The judges' model calls.
      {
        Effect = "Allow"
        Action = ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"]
        Resource = [
          "arn:${local.partition}:bedrock:*::foundation-model/*",
          "arn:${local.partition}:bedrock:*:${local.account}:inference-profile/*",
        ]
      },
    ]
  })
}

resource "aws_bedrockagentcore_online_evaluation_config" "live" {
  count = local.evaluate ? 1 : 0

  # Names allow letters, digits and underscores only.
  online_evaluation_config_name = "${replace(local.prefix, "-", "_")}_live"
  description                   = "Scores a sample of the ${var.project} claim agent's live sessions"
  evaluation_execution_role_arn = aws_iam_role.evaluations[0].arn
  enable_on_create              = true

  data_source_config {
    cloudwatch_logs {
      log_group_names = ["aws/spans"]
      # <runtime name>.<endpoint name>, as AgentCore Runtime names the agent's service in its spans.
      service_names = ["${local.runtime_name}.DEFAULT"]
    }
  }

  evaluator {
    evaluator_id = "Builtin.Helpfulness"
  }

  evaluator {
    evaluator_id = "Builtin.GoalSuccessRate"
  }

  rule {
    sampling_config {
      sampling_percentage = var.evaluation_sampling
    }
  }

  depends_on = [aws_iam_role_policy.evaluations, aws_bedrockagentcore_agent_runtime.agent]
}
