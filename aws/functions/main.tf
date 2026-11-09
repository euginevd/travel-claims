# The api, context and copilot on Lambda (spec 31), each from the newest image the images workflow pushed.
data "aws_caller_identity" "current" {}
data "aws_partition" "current" {}
data "aws_region" "current" {}

# Claude's Australian inference profiles, found in the region unless a variable names one.
data "aws_bedrock_inference_profiles" "system" {
  type = "SYSTEM_DEFINED"
}

locals {
  profiles = data.aws_bedrock_inference_profiles.system.inference_profile_summaries[*].inference_profile_id
  sonnet   = coalesce(var.sonnet_model, try(sort([for id in local.profiles : id if startswith(id, "au.anthropic.claude-sonnet-5-5")])[0], "none"))
  haiku    = coalesce(var.haiku_model, try(sort([for id in local.profiles : id if startswith(id, "au.anthropic.claude-haiku-5-5")])[0], "none"))
}

locals {
  account   = data.aws_caller_identity.current.account_id
  partition = data.aws_partition.current.partition
  region    = data.aws_region.current.region
  prefix    = "${var.project}-${var.environment}"
  boundary  = "arn:${local.partition}:iam::${local.account}:policy/${var.project}-boundary"
  receipts  = "${var.project}-receipts-${var.environment}-${local.account}"

  # Size and time for each function; the copilot's chat turns take longest.
  functions = {
    api     = { memory = 1024, timeout = 30 }
    context = { memory = 512, timeout = 30 }
    copilot = { memory = 1024, timeout = 60 }
  }
  audiences = { customers = "CUSTOMER", staff = "STAFF", engineering = "ENGINEERING" }
}

data "aws_ecr_image" "newest" {
  for_each = local.functions

  repository_name = "${var.project}/${each.key}"
  most_recent     = true
}

data "aws_ecr_repository" "app" {
  for_each = local.functions

  name = "${var.project}/${each.key}"
}

data "aws_secretsmanager_secret" "app" {
  name = "${var.project}/${var.environment}/app"
}

data "aws_cognito_user_pools" "audience" {
  for_each = local.audiences

  name = "${local.prefix}-${each.key}"
}

data "aws_cognito_user_pool_clients" "audience" {
  for_each = local.audiences

  user_pool_id = one(data.aws_cognito_user_pools.audience[each.key].ids)
}

resource "aws_cloudwatch_log_group" "function" {
  #checkov:skip=CKV_AWS_158: AWS-managed encryption is enough for app logs; a customer key adds a key policy to run
  #checkov:skip=CKV_AWS_338: 30-day retention keeps cost down (costs.md); raise it per environment if audits need more
  for_each = local.functions

  name              = "/aws/lambda/${local.prefix}-${each.key}"
  retention_in_days = 30
}

resource "aws_iam_role" "function" {
  for_each = local.functions

  name                 = "${local.prefix}-${each.key}"
  description          = "Execution role for the ${var.project} ${each.key} function"
  permissions_boundary = local.boundary

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

# What each function may do, beyond writing its own logs.
locals {
  grants = {
    api = [
      { actions = ["s3:GetObject", "s3:PutObject"], resources = ["arn:${local.partition}:s3:::${local.receipts}/*"] },
      { actions = ["secretsmanager:GetSecretValue"], resources = [data.aws_secretsmanager_secret.app.arn] },
      # The demo's test buttons: a fresh password per sign-in, so none is stored.
      { actions = ["cognito-idp:AdminSetUserPassword"], resources = [for name, _ in local.audiences : "arn:${local.partition}:cognito-idp:${local.region}:${local.account}:userpool/${one(data.aws_cognito_user_pools.audience[name].ids)}"] },
      { actions = ["bedrock-agentcore:InvokeAgentRuntime"], resources = ["arn:${local.partition}:bedrock-agentcore:${local.region}:${local.account}:runtime/*"] },
    ]
    context = []
    copilot = [
      { actions = ["secretsmanager:GetSecretValue"], resources = [data.aws_secretsmanager_secret.app.arn] },
      {
        actions = ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream", "bedrock:ApplyGuardrail"]
        resources = [
          "arn:${local.partition}:bedrock:*::foundation-model/anthropic.claude-*",
          "arn:${local.partition}:bedrock:*:${local.account}:inference-profile/*",
          "arn:${local.partition}:bedrock:${local.region}:${local.account}:guardrail/*",
        ]
      },
    ]
  }
}

resource "aws_iam_role_policy" "function" {
  for_each = local.functions

  name = "function"
  role = aws_iam_role.function[each.key].id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = concat(
      [{
        Effect   = "Allow"
        Action   = ["logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "${aws_cloudwatch_log_group.function[each.key].arn}:*"
      }],
      [for grant in local.grants[each.key] : { Effect = "Allow", Action = grant.actions, Resource = grant.resources }],
    )
  })
}

locals {
  issuers = {
    for name, prefix in local.audiences :
    "${prefix}_TOKEN_ISSUER" => "https://cognito-idp.${local.region}.amazonaws.com/${one(data.aws_cognito_user_pools.audience[name].ids)}"
  }
  token_audiences = {
    for name, prefix in local.audiences :
    "${prefix}_TOKEN_AUDIENCE" => one(data.aws_cognito_user_pool_clients.audience[name].client_ids)
  }
  service_environment = {
    api = merge(local.issuers, local.token_audiences, {
      ENVIRONMENT     = var.environment
      APP_SECRET      = data.aws_secretsmanager_secret.app.name
      RECEIPTS_BUCKET = local.receipts
      # The demo's test-account buttons and the project page's counts; drop it to turn both off.
      TEST_SIGN_IN = "true"
    })
    context = { CONTEXT_ALLOWED_HOSTS = "*" }
  }
}

# The api and the context layer; the copilot is below, since it needs the api's address.
resource "aws_lambda_function" "service" {
  #checkov:skip=CKV_AWS_117: nothing private to reach, so no VPC; Supabase and AWS's APIs are public endpoints
  #checkov:skip=CKV_AWS_116: called synchronously through its URL, so a dead-letter queue never receives anything
  #checkov:skip=CKV_AWS_115: Lambda's account limit caps the load; reserved concurrency can fail in new accounts
  #checkov:skip=CKV_AWS_50: tracing is off in the demo; turn on X-Ray when debugging calls across apps
  #checkov:skip=CKV_AWS_272: code signing applies to zip packages; these run signed-by-digest images from the project's ECR
  #checkov:skip=CKV_AWS_173: the environment holds names, not secrets; secrets come from Secrets Manager at start
  for_each = { for name, size in local.functions : name => size if name != "copilot" }

  function_name = "${local.prefix}-${each.key}"
  role          = aws_iam_role.function[each.key].arn
  package_type  = "Image"
  image_uri     = "${data.aws_ecr_repository.app[each.key].repository_url}@${data.aws_ecr_image.newest[each.key].image_digest}"
  architectures = ["x86_64"]
  memory_size   = each.value.memory
  timeout       = each.value.timeout

  environment {
    variables = local.service_environment[each.key]
  }

  logging_config {
    log_format = "Text"
    log_group  = aws_cloudwatch_log_group.function[each.key].name
  }

  depends_on = [aws_iam_role_policy.function]
}

resource "aws_lambda_function" "copilot" {
  #checkov:skip=CKV_AWS_117: nothing private to reach, so no VPC; Supabase and AWS's APIs are public endpoints
  #checkov:skip=CKV_AWS_116: called synchronously through its URL, so a dead-letter queue never receives anything
  #checkov:skip=CKV_AWS_115: Lambda's account limit caps the load; reserved concurrency can fail in new accounts
  #checkov:skip=CKV_AWS_50: tracing is off in the demo; turn on X-Ray when debugging calls across apps
  #checkov:skip=CKV_AWS_272: code signing applies to zip packages; these run signed-by-digest images from the project's ECR
  #checkov:skip=CKV_AWS_173: the environment holds names, not secrets; secrets come from Secrets Manager at start
  function_name = "${local.prefix}-copilot"
  role          = aws_iam_role.function["copilot"].arn
  package_type  = "Image"
  image_uri     = "${data.aws_ecr_repository.app["copilot"].repository_url}@${data.aws_ecr_image.newest["copilot"].image_digest}"
  architectures = ["x86_64"]
  memory_size   = local.functions.copilot.memory
  timeout       = local.functions.copilot.timeout

  environment {
    variables = {
      ENVIRONMENT    = var.environment
      APP_SECRET     = data.aws_secretsmanager_secret.app.name
      MODEL_PROVIDER = "bedrock"
      COPILOT_MODEL  = local.sonnet
      UNDERCOVER_API = trimsuffix(aws_lambda_function_url.service["api"].function_url, "/")
    }
  }

  logging_config {
    log_format = "Text"
    log_group  = aws_cloudwatch_log_group.function["copilot"].name
  }

  depends_on = [aws_iam_role_policy.function]

  lifecycle {
    precondition {
      condition     = local.sonnet != "none" && local.haiku != "none"
      error_message = "No Australian inference profile for Claude Sonnet 5.5 or Haiku 5.5 here: turn on model access in the Bedrock console, or set sonnet_model and haiku_model."
    }
  }
}

# The api checks tokens or the agent's key itself; the context has no auth of its own, so only the agent's role may call it.
resource "aws_lambda_function_url" "service" {
  #checkov:skip=CKV_AWS_258: the api authenticates every request itself; the context's URL is AWS_IAM
  for_each = aws_lambda_function.service

  function_name      = each.value.function_name
  authorization_type = each.key == "context" ? "AWS_IAM" : "NONE"
}

resource "aws_lambda_function_url" "copilot" {
  #checkov:skip=CKV_AWS_258: the copilot checks each handler's token with the api on every request
  function_name      = aws_lambda_function.copilot.function_name
  authorization_type = "NONE"
}
