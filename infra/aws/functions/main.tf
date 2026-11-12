# The api, context and copilot on Lambda, each from the newest image the images workflow pushed.
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
  # The API takes plain names; Bedrock takes Australia's inference profiles.
  sonnet = local.bedrock ? coalesce(var.sonnet_model, try(sort([for id in local.profiles : id if startswith(id, "au.anthropic.claude-sonnet-5-5")])[0], "none")) : "claude-sonnet-5-5"
  haiku  = local.bedrock ? coalesce(var.haiku_model, try(sort([for id in local.profiles : id if startswith(id, "au.anthropic.claude-haiku-5-5")])[0], "none")) : "claude-haiku-5-5"
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
    # The api's first start builds DSQL's schema, so it has as long as CloudFront waits.
    api     = { memory = 1024, timeout = 60 }
    context = { memory = 512, timeout = 30 }
    copilot = { memory = 1024, timeout = 60 }
  }
  audiences = { customers = "CUSTOMER", staff = "STAFF", engineering = "ENGINEERING" }

  # AgentCore Identity (identity unit): each app's workload identity and what it fetches from the vault.
  vault          = "arn:${local.partition}:bedrock-agentcore:${local.region}:${local.account}:token-vault/default"
  workloads      = "arn:${local.partition}:bedrock-agentcore:${local.region}:${local.account}:workload-identity-directory/default"
  vault_secrets  = "arn:${local.partition}:secretsmanager:${local.region}:${local.account}:secret:bedrock-agentcore-identity!default"
  agent_provider = "${local.prefix}-agent-access"
  # The Anthropic key's provider (secrets unit), when the apps use the API.
  key_provider = local.bedrock ? "" : "${local.prefix}-anthropic"
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

# The app's settings parameter (secrets unit), named here so the plan never reads its value.
locals {
  app_parameter     = "/${var.project}/${var.environment}/app"
  app_parameter_arn = "arn:${local.partition}:ssm:${local.region}:${local.account}:parameter${local.app_parameter}"
}

# The services pool (identity unit): the agent's machine client calls the api's agent routes.
data "aws_cognito_user_pools" "services" {
  name = "${local.prefix}-services"
}

data "aws_cognito_user_pool_clients" "services" {
  user_pool_id = one(data.aws_cognito_user_pools.services.ids)
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
  #checkov:skip=CKV_AWS_158: the platform's key with ENCRYPTION_KEYS=platform (encryption.tf), AWS-owned otherwise
  #checkov:skip=CKV_AWS_338: 30-day retention keeps cost down (costs.md); the platform's log archive keeps the long record
  for_each = local.functions

  name              = "/aws/lambda/${local.prefix}-${each.key}"
  retention_in_days = 30
  kms_key_id        = local.data_key
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
      { actions = ["ssm:GetParameter"], resources = [local.app_parameter_arn] },
      # The demo's test buttons: a fresh password per sign-in, so none is stored.
      { actions = ["cognito-idp:AdminSetUserPassword"], resources = [for name, _ in local.audiences : "arn:${local.partition}:cognito-idp:${local.region}:${local.account}:userpool/${one(data.aws_cognito_user_pools.audience[name].ids)}"] },
      # A machine token for the agent's runtime, from the vault through the api's workload identity.
      { actions = ["bedrock-agentcore:GetWorkloadAccessToken"], resources = [local.workloads, "${local.workloads}/workload-identity/${local.prefix}-api"] },
      { actions = ["bedrock-agentcore:GetResourceOauth2Token"], resources = [local.vault, "${local.vault}/oauth2credentialprovider/${local.agent_provider}", "${local.workloads}/workload-identity/${local.prefix}-api"] },
      { actions = ["secretsmanager:GetSecretValue"], resources = ["${local.vault_secrets}/oauth2/${local.agent_provider}*"] },
      # The records in DSQL, signed in as admin with an IAM token (decision 30).
      { actions = ["dsql:DbConnectAdmin"], resources = ["arn:${local.partition}:dsql:${local.region}:${local.account}:cluster/*"] },
      # DATABASE_APP_ROLE (decision 45): requests through a role that can't change the schema; the
      # schema build at each cold start still signs in as admin.
      { actions = ["dsql:DbConnect"], resources = ["arn:${local.partition}:dsql:${local.region}:${local.account}:cluster/*"] },
    ]
    context = []
    copilot = [
      { actions = ["ssm:GetParameter"], resources = [local.app_parameter_arn] },
      # The Anthropic key from the vault, through the Copilot's workload identity.
      { actions = ["bedrock-agentcore:GetWorkloadAccessToken"], resources = [local.workloads, "${local.workloads}/workload-identity/${local.prefix}-copilot"] },
      { actions = ["bedrock-agentcore:GetResourceApiKey"], resources = [local.vault, "${local.vault}/apikeycredentialprovider/${local.prefix}-anthropic", "${local.workloads}/workload-identity/${local.prefix}-copilot"] },
      { actions = ["secretsmanager:GetSecretValue"], resources = ["${local.vault_secrets}/apikey/${local.prefix}-*"] },
      # Conversations, their saved progress and handlers' notes (database unit).
      {
        actions   = ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem", "dynamodb:DeleteItem", "dynamodb:Query", "dynamodb:BatchGetItem", "dynamodb:BatchWriteItem"]
        resources = [for t in ["checkpoints", "copilot", "copilot/index/*"] : "arn:${local.partition}:dynamodb:${local.region}:${local.account}:table/${var.project}-${var.environment}-${t}"]
      },
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
      # The platform's key, through the services that hold the data (encryption.tf); not the context's.
      [for grant in(each.key == "context" ? [] : local.key_grants) : { Effect = "Allow", Action = grant.actions, Resource = grant.resources, Condition = grant.condition }],
      # Lambda's network interfaces in the private subnets; these take no resource ARN.
      local.private ? [{
        Effect   = "Allow"
        Action   = ["ec2:CreateNetworkInterface", "ec2:DescribeNetworkInterfaces", "ec2:DescribeSubnets", "ec2:DeleteNetworkInterface", "ec2:AssignPrivateIpAddresses", "ec2:UnassignPrivateIpAddresses"]
        Resource = "*"
      }] : [],
    )
  })
}

locals {
  agent_caller_issuer = "https://cognito-idp.${local.region}.amazonaws.com/${one(data.aws_cognito_user_pools.services.ids)}"
  agent_caller_client = zipmap(data.aws_cognito_user_pool_clients.services.client_names, data.aws_cognito_user_pool_clients.services.client_ids)["${local.prefix}-agent"]
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
      APP_SECRET      = local.app_parameter
      RECEIPTS_BUCKET = local.receipts
      # The demo's test-account buttons and the project page's counts; drop it to turn both off.
      TEST_SIGN_IN = "true"
      # The agent's runtime takes the api's machine token, which AgentCore Identity fetches.
      WORKLOAD_NAME        = "${local.prefix}-api"
      AGENT_TOKEN_PROVIDER = local.agent_provider
      #checkov:skip=CKV_SECRET_6: an OAuth scope name, not a secret
      AGENT_TOKEN_SCOPE = "undercover-agent/invoke"
      # The agent's calls back carry its machine token, not the shared key (decision 38).
      AGENT_CALLER_ISSUER = local.agent_caller_issuer
      AGENT_CALLER_CLIENT = local.agent_caller_client
      },
      # With DATABASE_APP_ROLE=true, the api serves requests as this database role (decision 45).
      var.database_app_role ? { DATABASE_APP_ROLE = "undercover_app", DATABASE_APP_ROLE_IAM = aws_iam_role.function["api"].arn } : {},
    )
    # No URL: AgentCore Gateway invokes it by ARN, and the adapter passes each call to /events.
    context = { CONTEXT_ALLOWED_HOSTS = "*", CONTEXT_GATEWAY_EVENTS = "true" }
  }
}

# The api and the context layer; the copilot is below, since it needs the api's address.
resource "aws_lambda_function" "service" {
  #checkov:skip=CKV_AWS_117: in the platform's private subnets unless NETWORK_MODE=public; the check can't follow the dynamic block
  #checkov:skip=CKV_AWS_116: called synchronously through its URL, so a dead-letter queue never receives anything
  #checkov:skip=CKV_AWS_115: Lambda's account limit caps the load; reserved concurrency can fail in new accounts
  #checkov:skip=CKV_AWS_50: tracing is off in the demo; turn on X-Ray when debugging calls across apps
  #checkov:skip=CKV_AWS_272: code signing applies to zip packages; these run signed-by-digest images from the project's ECR
  #checkov:skip=CKV_AWS_173: the environment holds names, not secrets; settings come from Parameter Store at start
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

  # In the platform's private subnets unless NETWORK_MODE=public (network.tf).
  dynamic "vpc_config" {
    for_each = local.private ? [1] : []
    content {
      subnet_ids         = local.subnets
      security_group_ids = [aws_security_group.workload[0].id]
    }
  }

  depends_on = [aws_iam_role_policy.function]
}

resource "aws_lambda_function" "copilot" {
  #checkov:skip=CKV_AWS_117: in the platform's private subnets unless NETWORK_MODE=public; the check can't follow the dynamic block
  #checkov:skip=CKV_AWS_116: called synchronously through its URL, so a dead-letter queue never receives anything
  #checkov:skip=CKV_AWS_115: Lambda's account limit caps the load; reserved concurrency can fail in new accounts
  #checkov:skip=CKV_AWS_50: tracing is off in the demo; turn on X-Ray when debugging calls across apps
  #checkov:skip=CKV_AWS_272: code signing applies to zip packages; these run signed-by-digest images from the project's ECR
  #checkov:skip=CKV_AWS_173: the environment holds names, not secrets; settings come from Parameter Store at start
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
      APP_SECRET     = local.app_parameter
      MODEL_PROVIDER = var.model_provider
      COPILOT_MODEL  = local.sonnet
      UNDERCOVER_API = local.api_endpoint
      # The Copilot's workload identity, and the vaulted Anthropic key it fetches with it (none on Bedrock).
      WORKLOAD_NAME          = "${local.prefix}-copilot"
      ANTHROPIC_KEY_PROVIDER = local.key_provider
    }
  }

  logging_config {
    log_format = "Text"
    log_group  = aws_cloudwatch_log_group.function["copilot"].name
  }

  # In the platform's private subnets unless NETWORK_MODE=public (network.tf).
  dynamic "vpc_config" {
    for_each = local.private ? [1] : []
    content {
      subnet_ids         = local.subnets
      security_group_ids = [aws_security_group.workload[0].id]
    }
  }

  depends_on = [aws_iam_role_policy.function]

  lifecycle {
    precondition {
      condition     = !local.bedrock || (local.sonnet != "none" && local.haiku != "none")
      error_message = "No Australian inference profile for Claude Sonnet 5.5 or Haiku 5.5 here: turn on model access in the Bedrock console, or set sonnet_model and haiku_model."
    }
  }
}

# The api checks tokens or the agent's key itself. The context has no URL: only the gateway's role may invoke it.
resource "aws_lambda_function_url" "service" {
  #checkov:skip=CKV_AWS_258: the api authenticates every request itself
  # None behind API Gateway (api_gateway.tf); the context server never has one.
  for_each = { for name, fn in aws_lambda_function.service : name => fn if name != "context" && !local.gateway }

  function_name      = each.value.function_name
  authorization_type = "NONE"
}

resource "aws_lambda_function_url" "copilot" {
  #checkov:skip=CKV_AWS_258: the copilot checks each handler's token with the api on every request
  count = local.gateway ? 0 : 1

  function_name      = aws_lambda_function.copilot.function_name
  authorization_type = "NONE"
}
