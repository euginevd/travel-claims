# The claim agent on AgentCore Runtime (spec 32), from the newest arm64 image; applied after the functions unit.
data "aws_caller_identity" "current" {}
data "aws_partition" "current" {}
data "aws_region" "current" {}

# Claude's Australian inference profiles, found in the region unless a variable names one.
data "aws_bedrock_inference_profiles" "system" {
  type = "SYSTEM_DEFINED"
}

locals {
  profiles = data.aws_bedrock_inference_profiles.system.inference_profile_summaries[*].inference_profile_id
  bedrock  = var.model_provider == "bedrock"
  # The API takes plain names; Bedrock takes the Australian profiles.
  sonnet = local.bedrock ? coalesce(var.sonnet_model, try(sort([for id in local.profiles : id if startswith(id, "au.anthropic.claude-sonnet-5-5")])[0], "none")) : "claude-sonnet-5-5"
  haiku  = local.bedrock ? coalesce(var.haiku_model, try(sort([for id in local.profiles : id if startswith(id, "au.anthropic.claude-haiku-5-5")])[0], "none")) : "claude-haiku-5-5"
}

locals {
  account   = data.aws_caller_identity.current.account_id
  partition = data.aws_partition.current.partition
  region    = data.aws_region.current.region
  prefix    = "${var.project}-${var.environment}"
  boundary  = "arn:${local.partition}:iam::${local.account}:policy/${var.project}-boundary"
  # Runtime names allow letters, digits and underscores only.
  runtime_name = "${replace(var.project, "-", "_")}_${var.environment}_agent"
}

data "aws_ecr_repository" "agent" {
  name = "${var.project}/agent"
}

data "aws_ecr_image" "newest" {
  repository_name = data.aws_ecr_repository.agent.name
  most_recent     = true
}

data "aws_secretsmanager_secret" "app" {
  name = "${var.project}/${var.environment}/app"
}

data "aws_lambda_function_url" "api" {
  function_name = "${local.prefix}-api"
}

data "aws_lambda_function_url" "context" {
  function_name = "${local.prefix}-context"
}

resource "aws_iam_role" "agent" {
  name                 = "${local.prefix}-agent"
  description          = "Execution role for the ${var.project} claim agent on AgentCore Runtime"
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

resource "aws_iam_role_policy" "agent" {
  name = "agent"
  role = aws_iam_role.agent.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      { Effect = "Allow", Action = ["ecr:BatchGetImage", "ecr:GetDownloadUrlForLayer"], Resource = data.aws_ecr_repository.agent.arn },
      { Effect = "Allow", Action = "ecr:GetAuthorizationToken", Resource = "*" },
      {
        Effect   = "Allow"
        Action   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:DescribeLogStreams", "logs:PutLogEvents"]
        Resource = "arn:${local.partition}:logs:${local.region}:${local.account}:log-group:/aws/bedrock-agentcore/runtimes/*"
      },
      { Effect = "Allow", Action = ["xray:PutTraceSegments", "xray:PutTelemetryRecords"], Resource = "*" },
      {
        Effect    = "Allow"
        Action    = "cloudwatch:PutMetricData"
        Resource  = "*"
        Condition = { StringEquals = { "cloudwatch:namespace" = "bedrock-agentcore" } }
      },
      {
        Effect = "Allow"
        Action = ["bedrock-agentcore:GetWorkloadAccessToken", "bedrock-agentcore:GetWorkloadAccessTokenForJWT", "bedrock-agentcore:GetWorkloadAccessTokenForUserId"]
        Resource = [
          "arn:${local.partition}:bedrock-agentcore:${local.region}:${local.account}:workload-identity-directory/default",
          "arn:${local.partition}:bedrock-agentcore:${local.region}:${local.account}:workload-identity-directory/default/workload-identity/*",
        ]
      },
      {
        Effect = "Allow"
        Action = ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream", "bedrock:ApplyGuardrail"]
        Resource = [
          "arn:${local.partition}:bedrock:*::foundation-model/anthropic.claude-*",
          "arn:${local.partition}:bedrock:*:${local.account}:inference-profile/*",
          "arn:${local.partition}:bedrock:${local.region}:${local.account}:guardrail/*",
        ]
      },
      { Effect = "Allow", Action = "secretsmanager:GetSecretValue", Resource = data.aws_secretsmanager_secret.app.arn },
      # The context's URL takes only IAM-signed calls, and only this role may make them.
      { Effect = "Allow", Action = ["lambda:InvokeFunctionUrl", "lambda:InvokeFunction"], Resource = "arn:${local.partition}:lambda:${local.region}:${local.account}:function:${local.prefix}-context" },
    ]
  })
}

resource "aws_bedrockagentcore_agent_runtime" "agent" {
  agent_runtime_name = local.runtime_name
  description        = "The ${var.project} claim agent"
  role_arn           = aws_iam_role.agent.arn

  agent_runtime_artifact {
    container_configuration {
      container_uri = "${data.aws_ecr_repository.agent.repository_url}@${data.aws_ecr_image.newest.image_digest}"
    }
  }

  network_configuration {
    network_mode = "PUBLIC"
  }

  protocol_configuration {
    server_protocol = "HTTP"
  }

  # An idle session ends after 2 minutes, freeing its connections; /ping keeps it while working, up to 8 hours.
  lifecycle_configuration = [{
    idle_runtime_session_timeout = 120
    max_lifetime                 = 28800
  }]

  environment_variables = {
    ENVIRONMENT        = var.environment
    APP_SECRET         = data.aws_secretsmanager_secret.app.name
    MODEL_PROVIDER     = var.model_provider
    CONTEXT_AWS_AUTH   = "true"
    AGENTCORE_RUNTIME  = "true"
    CLAIM_MODEL        = local.sonnet
    IMPROVER_MODEL     = local.sonnet
    SCREENING_MODEL    = local.haiku
    SPECIALIST_MODEL   = local.haiku
    DRAFTING_MODEL     = local.haiku
    UNDERCOVER_API     = trimsuffix(data.aws_lambda_function_url.api.function_url, "/")
    UNDERCOVER_CONTEXT = "${trimsuffix(data.aws_lambda_function_url.context.function_url, "/")}/mcp"
  }

  depends_on = [aws_iam_role_policy.agent]

  lifecycle {
    # Spec 26: prod sends claim data only to Bedrock in Australia.
    precondition {
      condition     = var.environment != "prod" || local.bedrock
      error_message = "prod uses Bedrock only (spec 26): set the MODEL_PROVIDER variable to bedrock."
    }
    precondition {
      condition     = !local.bedrock || (local.sonnet != "none" && local.haiku != "none")
      error_message = "No Australian inference profile for Claude Sonnet 5.5 or Haiku 5.5 here: turn on model access in the Bedrock console, or set sonnet_model and haiku_model."
    }
  }
}

# Tells the api where the agent runs, through the app secret it reads at start.
resource "terraform_data" "runtime_arn" {
  triggers_replace = [aws_bedrockagentcore_agent_runtime.agent.agent_runtime_arn]

  provisioner "local-exec" {
    command = "python3 ${path.module}/../../scripts/fill-secret.py ${data.aws_secretsmanager_secret.app.name} AGENT_RUNTIME_ARN=${aws_bedrockagentcore_agent_runtime.agent.agent_runtime_arn}"
  }
}
