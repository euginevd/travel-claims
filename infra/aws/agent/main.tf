# The claim agent on AgentCore Runtime, from the newest arm64 image; applied after the functions unit.
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

# The app's settings parameter (secrets unit), named here so the plan never reads its value.
locals {
  app_parameter     = "/${var.project}/${var.environment}/app"
  app_parameter_arn = "arn:${local.partition}:ssm:${local.region}:${local.account}:parameter${local.app_parameter}"
}

# Where the agent reaches the api: the functions unit's API Gateway, or the api's URL (decision 39).
data "aws_lambda_function_url" "api" {
  count         = var.api_gateway ? 0 : 1
  function_name = "${local.prefix}-api"
}

data "aws_api_gateway_rest_api" "api" {
  count = var.api_gateway ? 1 : 0
  name  = "${local.prefix}-api"
}

locals {
  api_endpoint = (var.api_gateway
    ? "https://${data.aws_api_gateway_rest_api.api[0].id}.execute-api.${local.region}.amazonaws.com/${var.environment}"
  : trimsuffix(data.aws_lambda_function_url.api[0].function_url, "/"))
}

# The context server has no URL: the gateways invoke it by ARN (Lambda targets).
data "aws_lambda_function" "context" {
  function_name = "${local.prefix}-context"
}

# AgentCore Identity (identity unit): the api's machine client signs in to the runtime, and
# handlers' own tokens sign in to the Copilot's gateway.
data "aws_cognito_user_pools" "pool" {
  for_each = toset(["services", "staff"])

  name = "${local.prefix}-${each.key}"
}

data "aws_cognito_user_pool_clients" "pool" {
  for_each = data.aws_cognito_user_pools.pool

  user_pool_id = one(each.value.ids)
}

# The services pool's clients by name: the api's invokes the runtime; the agent's calls the api.
locals {
  service_clients = zipmap(data.aws_cognito_user_pool_clients.pool["services"].client_names, data.aws_cognito_user_pool_clients.pool["services"].client_ids)
}

locals {
  discovery = { for name, pool in data.aws_cognito_user_pools.pool : name => "https://cognito-idp.${local.region}.amazonaws.com/${one(pool.ids)}/.well-known/openid-configuration" }
  # The Anthropic key's provider in the token vault (secrets unit), when the apps use the API.
  key_provider = local.bedrock ? "" : "${local.prefix}-anthropic"
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
    Statement = concat([
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
          "arn:${local.partition}:bedrock-agentcore:${local.region}:${local.account}:workload-identity-directory/default/workload-identity/${local.prefix}-agent",
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
      { Effect = "Allow", Action = "ssm:GetParameter", Resource = local.app_parameter_arn },
      # The Anthropic key from the token vault, through the agent's workload identity.
      {
        Effect = "Allow"
        Action = "bedrock-agentcore:GetResourceApiKey"
        Resource = [
          "arn:${local.partition}:bedrock-agentcore:${local.region}:${local.account}:token-vault/default",
          "arn:${local.partition}:bedrock-agentcore:${local.region}:${local.account}:token-vault/default/apikeycredentialprovider/*",
          # The directory too: AgentCore checks the call against it as well as the workload.
          "arn:${local.partition}:bedrock-agentcore:${local.region}:${local.account}:workload-identity-directory/default",
          "arn:${local.partition}:bedrock-agentcore:${local.region}:${local.account}:workload-identity-directory/default/workload-identity/${local.prefix}-agent",
        ]
      },
      {
        Effect   = "Allow"
        Action   = "secretsmanager:GetSecretValue"
        Resource = "arn:${local.partition}:secretsmanager:${local.region}:${local.account}:secret:bedrock-agentcore-identity!default/apikey/${local.prefix}-*"
      },
      # A machine token for the agent's calls back to the api, from the vault (decision 38).
      {
        Effect = "Allow"
        Action = "bedrock-agentcore:GetResourceOauth2Token"
        Resource = [
          "arn:${local.partition}:bedrock-agentcore:${local.region}:${local.account}:token-vault/default",
          "arn:${local.partition}:bedrock-agentcore:${local.region}:${local.account}:token-vault/default/oauth2credentialprovider/${local.prefix}-api-access",
          # The directory too: AgentCore checks the call against it as well as the workload.
          "arn:${local.partition}:bedrock-agentcore:${local.region}:${local.account}:workload-identity-directory/default",
          "arn:${local.partition}:bedrock-agentcore:${local.region}:${local.account}:workload-identity-directory/default/workload-identity/${local.prefix}-agent",
        ]
      },
      {
        Effect   = "Allow"
        Action   = "secretsmanager:GetSecretValue"
        Resource = "arn:${local.partition}:secretsmanager:${local.region}:${local.account}:secret:bedrock-agentcore-identity!default/oauth2/${local.prefix}-api-access*"
      },
      # Each claim's saved progress (database unit).
      {
        Effect   = "Allow"
        Action   = ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:Query", "dynamodb:BatchGetItem", "dynamodb:BatchWriteItem"]
        Resource = "arn:${local.partition}:dynamodb:${local.region}:${local.account}:table/${local.prefix}-checkpoints"
      },
      # The context layer only through its gateway, which alone may call the context's URL.
      { Effect = "Allow", Action = "bedrock-agentcore:InvokeGateway", Resource = aws_bedrockagentcore_gateway.context.gateway_arn },
      # The customers' memory: write a decided claim's record, list one customer's.
      { Effect = "Allow", Action = ["bedrock-agentcore:BatchCreateMemoryRecords", "bedrock-agentcore:ListMemoryRecords"], Resource = aws_bedrockagentcore_memory.customers.arn },
      # Ask UnderCover searches the policy wording in its knowledge base.
      { Effect = "Allow", Action = "bedrock:Retrieve", Resource = aws_bedrockagent_knowledge_base.wording.arn },
      # Ask UnderCover's answers against the wording's rules: the reasoning guardrail evaluates
      # this project's Automated Reasoning policy as the agent (decision 48).
      { Effect = "Allow", Action = "bedrock:InvokeAutomatedReasoningPolicy", Resource = "arn:${local.partition}:bedrock:${local.region}:${local.account}:automated-reasoning-policy/*" },
      # Through Australia's guardrail profile, which routes from Sydney to Sydney only.
      { Effect = "Allow", Action = "bedrock:ApplyGuardrail", Resource = "arn:${local.partition}:bedrock:${local.region}:${local.account}:guardrail-profile/au.guardrail.v1:0" },
      # Receipts read into fields before any model sees them (decision 48); Textract has no
      # resource-level permissions, and the region condition keeps it in this one.
      { Effect = "Allow", Action = "textract:AnalyzeExpense", Resource = "*", Condition = { StringEquals = { "aws:RequestedRegion" = local.region } } },
      ],
      # Lookup programs, only while they're on: one short session each on their own interpreter.
      [for ci in aws_bedrockagentcore_code_interpreter.programs : {
        Effect   = "Allow"
        Action   = ["bedrock-agentcore:StartCodeInterpreterSession", "bedrock-agentcore:InvokeCodeInterpreter", "bedrock-agentcore:StopCodeInterpreterSession"]
        Resource = ci.code_interpreter_arn
      }],
      # The platform's key with ENCRYPTION_KEYS=platform, only through the settings and checkpoints (decision 45).
      local.data_key == null ? [] : [{
        Effect    = "Allow"
        Action    = ["kms:Decrypt", "kms:GenerateDataKey"]
        Resource  = local.data_key
        Condition = { StringLike = { "kms:ViaService" = ["ssm.*.amazonaws.com", "dynamodb.*.amazonaws.com"] } }
    }])
  })
}

# The agent's memory of each customer (plan phase 4, R20): records the agent writes itself, one
# namespace per customer, with no strategy, so no model extracts anything from customers' words.
resource "aws_bedrockagentcore_memory" "customers" {
  # Memory names allow letters, digits and underscores only.
  name                  = "${replace(local.prefix, "-", "_")}_customers"
  description           = "What the ${var.project} claim agent remembers of each customer's claims"
  event_expiry_duration = 7
}

# The policy wording in a Bedrock Knowledge Base on S3 Vectors (plan phase 4), one document per
# section (data/knowledge, made by undercover_context.knowledge), for Ask UnderCover's search.
locals {
  knowledge_dir   = "${path.module}/../../../data/knowledge/policy_wording"
  knowledge_files = fileset(local.knowledge_dir, "*")
  embedding_model = "arn:${local.partition}:bedrock:${local.region}::foundation-model/amazon.titan-embed-text-v2:0"
}

resource "aws_s3_bucket" "knowledge" {
  #checkov:skip=CKV_AWS_18: access logs need a second bucket; the files are the public policy wording
  #checkov:skip=CKV_AWS_144: one region is enough; the files are rebuilt from the repo
  #checkov:skip=CKV_AWS_145: S3-managed encryption is enough for the public policy wording
  #checkov:skip=CKV2_AWS_62: the apply starts ingestion itself; nothing reacts to new objects
  bucket        = "${var.project}-knowledge-${var.environment}-${local.account}"
  force_destroy = true
}

resource "aws_s3_bucket_public_access_block" "knowledge" {
  bucket                  = aws_s3_bucket.knowledge.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "knowledge" {
  bucket = aws_s3_bucket.knowledge.id
  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

# trivy:ignore:AWS-0132 S3-managed encryption is enough for the public policy wording
resource "aws_s3_bucket_server_side_encryption_configuration" "knowledge" {
  bucket = aws_s3_bucket.knowledge.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_versioning" "knowledge" {
  bucket = aws_s3_bucket.knowledge.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "knowledge" {
  bucket = aws_s3_bucket.knowledge.id

  rule {
    id     = "expire-old-versions"
    status = "Enabled"
    filter {}
    noncurrent_version_expiration {
      noncurrent_days = 30
    }
    abort_incomplete_multipart_upload {
      days_after_initiation = 1
    }
  }

  depends_on = [aws_s3_bucket_versioning.knowledge]
}

resource "aws_s3_bucket_policy" "knowledge" {
  bucket = aws_s3_bucket.knowledge.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "DenyInsecureTransport"
      Effect    = "Deny"
      Principal = "*"
      Action    = "s3:*"
      Resource  = [aws_s3_bucket.knowledge.arn, "${aws_s3_bucket.knowledge.arn}/*"]
      Condition = { Bool = { "aws:SecureTransport" = "false" } }
    }]
  })

  depends_on = [aws_s3_bucket_public_access_block.knowledge]
}

resource "aws_s3_object" "knowledge" {
  for_each = local.knowledge_files

  bucket       = aws_s3_bucket.knowledge.id
  key          = "policy_wording/${each.value}"
  source       = "${local.knowledge_dir}/${each.value}"
  etag         = filemd5("${local.knowledge_dir}/${each.value}")
  content_type = endswith(each.value, ".json") ? "application/json" : "text/markdown"
}

resource "aws_s3vectors_vector_bucket" "knowledge" {
  vector_bucket_name = "${local.prefix}-knowledge"
  force_destroy      = true
}

# Titan Text Embeddings V2 gives 1024 dimensions; the text and Bedrock's own metadata are not filters.
resource "aws_s3vectors_index" "wording" {
  vector_bucket_name = aws_s3vectors_vector_bucket.knowledge.vector_bucket_name
  index_name         = "policy-wording"
  data_type          = "float32"
  dimension          = 1024
  distance_metric    = "cosine"

  metadata_configuration {
    non_filterable_metadata_keys = ["AMAZON_BEDROCK_TEXT", "AMAZON_BEDROCK_METADATA"]
  }
}

resource "aws_iam_role" "knowledge" {
  name                 = "${local.prefix}-knowledge"
  description          = "Embeds the ${var.project} policy wording into its knowledge base"
  permissions_boundary = local.boundary

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "bedrock.amazonaws.com" }
      Action    = "sts:AssumeRole"
      Condition = {
        StringEquals = { "aws:SourceAccount" = local.account }
        ArnLike      = { "aws:SourceArn" = "arn:${local.partition}:bedrock:${local.region}:${local.account}:knowledge-base/*" }
      }
    }]
  })
}

resource "aws_iam_role_policy" "knowledge" {
  name = "knowledge"
  role = aws_iam_role.knowledge.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      { Effect = "Allow", Action = "bedrock:InvokeModel", Resource = local.embedding_model },
      { Effect = "Allow", Action = "s3:ListBucket", Resource = aws_s3_bucket.knowledge.arn },
      { Effect = "Allow", Action = "s3:GetObject", Resource = "${aws_s3_bucket.knowledge.arn}/*" },
      {
        Effect   = "Allow"
        Action   = ["s3vectors:PutVectors", "s3vectors:GetVectors", "s3vectors:DeleteVectors", "s3vectors:QueryVectors", "s3vectors:GetIndex"]
        Resource = aws_s3vectors_index.wording.index_arn
      },
    ]
  })
}

resource "aws_bedrockagent_knowledge_base" "wording" {
  name        = "${local.prefix}-wording"
  description = "The ${var.project} policy wording, one document per section"
  role_arn    = aws_iam_role.knowledge.arn

  knowledge_base_configuration {
    type = "VECTOR"
    vector_knowledge_base_configuration {
      embedding_model_arn = local.embedding_model
    }
  }

  storage_configuration {
    type = "S3_VECTORS"
    s3_vectors_configuration {
      index_arn = aws_s3vectors_index.wording.index_arn
    }
  }

  depends_on = [aws_iam_role_policy.knowledge]
}

resource "aws_bedrockagent_data_source" "wording" {
  name              = "policy-wording"
  knowledge_base_id = aws_bedrockagent_knowledge_base.wording.id

  data_source_configuration {
    type = "S3"
    s3_configuration {
      bucket_arn         = aws_s3_bucket.knowledge.arn
      inclusion_prefixes = ["policy_wording/"]
    }
  }

  # Each file is one section already, so no further chunking.
  vector_ingestion_configuration {
    chunking_configuration {
      chunking_strategy = "NONE"
    }
  }
}

# Ingest again whenever a section's file changes.
resource "terraform_data" "ingest" {
  triggers_replace = [
    aws_bedrockagent_data_source.wording.data_source_id,
    sha256(join("", [for f in local.knowledge_files : filemd5("${local.knowledge_dir}/${f}")])),
  ]

  provisioner "local-exec" {
    command = "aws bedrock-agent start-ingestion-job --knowledge-base-id ${aws_bedrockagent_knowledge_base.wording.id} --data-source-id ${aws_bedrockagent_data_source.wording.data_source_id} --query ingestionJob.status --output text"
  }

  depends_on = [aws_s3_object.knowledge]
}

# Lookup programs (plan phase 5, R24), only while CODE_EXECUTION is on: the agent's programs run
# here as a role that may call only the context gateway. The network is public, so a program could
# send out what the model has read: limit the sandbox's egress before switching this on (R24).
resource "aws_iam_role" "programs" {
  count = var.code_execution ? 1 : 0

  name                 = "${local.prefix}-programs"
  description          = "Runs the ${var.project} claim agent's lookup programs, which may call only the context gateway"
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

resource "aws_iam_role_policy" "programs" {
  count = var.code_execution ? 1 : 0

  name = "programs"
  role = aws_iam_role.programs[0].id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      { Effect = "Allow", Action = "bedrock-agentcore:InvokeGateway", Resource = aws_bedrockagentcore_gateway.context.gateway_arn },
    ]
  })
}

resource "aws_bedrockagentcore_code_interpreter" "programs" {
  count = var.code_execution ? 1 : 0

  # Names allow letters, digits and underscores only.
  name               = "${replace(local.prefix, "-", "_")}_programs"
  description        = "Runs the ${var.project} claim agent's lookup programs"
  execution_role_arn = aws_iam_role.programs[0].arn

  # Private: the VPC endpoints only (network.tf); public: the internet, with a role that can call
  # only the gateway.
  network_configuration {
    network_mode = local.private ? "VPC" : "PUBLIC"
    dynamic "vpc_config" {
      for_each = local.private ? [1] : []
      content {
        subnets         = local.subnets
        security_groups = [aws_security_group.programs[0].id]
      }
    }
  }

  depends_on = [aws_iam_role_policy.programs]
}

# AgentCore Gateway in front of the context layer (plan phase 3): the agent reaches its lookups as
# managed MCP tools, and the gateway invokes the context Lambda by its ARN with its own role.
resource "aws_iam_role" "gateway" {
  name                 = "${local.prefix}-gateway"
  description          = "Signs the ${var.project} gateway's calls to the context layer"
  permissions_boundary = local.boundary

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "bedrock-agentcore.amazonaws.com" }
      Action    = "sts:AssumeRole"
      Condition = {
        StringEquals = { "aws:SourceAccount" = local.account }
        ArnLike      = { "aws:SourceArn" = "arn:${local.partition}:bedrock-agentcore:${local.region}:${local.account}:gateway/*" }
      }
    }]
  })
}

resource "aws_iam_role_policy" "gateway" {
  name = "gateway"
  role = aws_iam_role.gateway.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      # Only this role may invoke the context server, which has no URL.
      { Effect = "Allow", Action = "lambda:InvokeFunction", Resource = data.aws_lambda_function.context.arn },
      # AgentCore Policy: the gateways ask the engine before each tool call (gateway/* avoids a cycle).
      {
        Effect = "Allow"
        Action = ["bedrock-agentcore:GetPolicyEngine", "bedrock-agentcore:AuthorizeAction", "bedrock-agentcore:PartiallyAuthorizeActions"]
        Resource = [
          aws_bedrockagentcore_policy_engine.tools.policy_engine_arn,
          "arn:${local.partition}:bedrock-agentcore:${local.region}:${local.account}:gateway/*",
        ]
      },
    ]
  })
}

# The context server's seven lookups, as its MCP server defines them (apps/context server.py).
locals {
  tools = {
    lookup_term           = { description = "Look up a term the policy wording defines: its definition and sections.", arguments = { term = { type = "string", description = "The term, 1 to 100 characters" } } }
    describe_fields       = { description = "Describe a record the claim agent reads and what each of its fields means.", arguments = { record = { type = "string", description = "claim, policy or previous_claim" } } }
    get_plan              = { description = "Get a plan's limits, waiting periods and deductible, and the add-ons.", arguments = { plan = { type = "string", description = "economy, premium or first" } } }
    get_claim_rules       = { description = "Get the rules claims operations applies to every claim.", arguments = {} }
    search_reference_data = { description = "Find outside facts, such as storms, strikes and prices, holding every word.", arguments = { query = { type = "string", description = "The words to find, 1 to 200 characters" } } }
    search_documents      = { description = "Find sections of the wording and the manual holding a word or phrase.", arguments = { query = { type = "string", description = "The words to find, 1 to 200 characters" } } }
    read_section          = { description = "Read one section of the policy wording or the claims manual in full.", arguments = { document = { type = "string", description = "policy_wording or claims_manual" }, number = { type = "integer", description = "The section's number" } } }
  }
  # What each gateway's callers may use (AgentCore Policy): the Copilot only reads the documents.
  allowed = {
    context       = keys(local.tools)
    staff_context = ["search_documents", "read_section"]
  }
}

# AgentCore Policy: Cedar rules outside the model's reach, checked before each tool call; anything
# not permitted is denied.
resource "aws_bedrockagentcore_policy_engine" "tools" {
  # Names allow letters, digits and underscores only.
  name        = "${replace(local.prefix, "-", "_")}_tools"
  description = "Which context lookups each ${var.project} gateway's callers may use"
}

resource "aws_bedrockagentcore_policy" "tools" {
  for_each = local.allowed

  name             = "${each.key}_tools"
  policy_engine_id = aws_bedrockagentcore_policy_engine.tools.policy_engine_id
  description      = "The lookups the ${each.key} gateway allows"

  definition {
    cedar {
      statement = <<-EOT
        permit(
          principal,
          action in [${join(", ", [for tool in each.value : "AgentCore::Action::\"context___${tool}\""])}],
          resource == AgentCore::Gateway::"${each.key == "context" ? aws_bedrockagentcore_gateway.context.gateway_arn : aws_bedrockagentcore_gateway.staff_context.gateway_arn}"
        );
      EOT
    }
  }

  # Policies are checked against the gateway's tools, so the targets come first.
  depends_on = [aws_bedrockagentcore_gateway_target.context, aws_bedrockagentcore_gateway_target.staff_context]
}

resource "aws_bedrockagentcore_gateway" "context" {
  name            = "${local.prefix}-context"
  description     = "The ${var.project} context layer's lookups for the claim agent"
  role_arn        = aws_iam_role.gateway.arn
  authorizer_type = "AWS_IAM"
  protocol_type   = "MCP"

  protocol_configuration {
    mcp {
      supported_versions = ["2026-07-28", "2025-11-25"]
    }
  }

  policy_engine_configuration {
    arn  = aws_bedrockagentcore_policy_engine.tools.policy_engine_arn
    mode = "ENFORCE"
  }

  depends_on = [aws_iam_role_policy.gateway]
}

# Gateway names each tool after this target: context___get_claim_rules.
resource "aws_bedrockagentcore_gateway_target" "context" {
  name               = "context"
  gateway_identifier = aws_bedrockagentcore_gateway.context.gateway_id
  description        = "The context layer's lookups, invoked on Lambda by ARN"

  # A Lambda target is invoked with the gateway's own role; a service name is for MCP, OpenAPI and
  # inference targets only, and AgentCore refuses it here.
  credential_provider_configuration {
    gateway_iam_role {}
  }

  target_configuration {
    mcp {
      lambda {
        lambda_arn = data.aws_lambda_function.context.arn
        tool_schema {
          dynamic "inline_payload" {
            for_each = local.tools
            content {
              name        = inline_payload.key
              description = inline_payload.value.description
              input_schema {
                type = "object"
                dynamic "property" {
                  for_each = inline_payload.value.arguments
                  content {
                    name        = property.key
                    type        = property.value.type
                    description = property.value.description
                    required    = true
                  }
                }
              }
            }
          }
        }
      }
    }
  }
}

# The same context layer for the Copilot, behind a gateway that takes a handler's own Cognito ID
# token instead of IAM: each lookup is tied to the handler who asked, and only handlers get in.
resource "aws_bedrockagentcore_gateway" "staff_context" {
  name            = "${local.prefix}-staff-context"
  description     = "The ${var.project} context layer's lookups for the Copilot, as the signed-in handler"
  role_arn        = aws_iam_role.gateway.arn
  authorizer_type = "CUSTOM_JWT"
  protocol_type   = "MCP"

  authorizer_configuration {
    custom_jwt_authorizer {
      discovery_url    = local.discovery.staff
      allowed_audience = data.aws_cognito_user_pool_clients.pool["staff"].client_ids
      custom_claim {
        inbound_token_claim_name       = "cognito:groups"
        inbound_token_claim_value_type = "STRING_ARRAY"
        authorizing_claim_match_value {
          claim_match_operator = "CONTAINS_ANY"
          claim_match_value {
            match_value_string_list = ["handlers"]
          }
        }
      }
    }
  }

  protocol_configuration {
    mcp {
      supported_versions = ["2026-07-28", "2025-11-25"]
    }
  }

  policy_engine_configuration {
    arn  = aws_bedrockagentcore_policy_engine.tools.policy_engine_arn
    mode = "ENFORCE"
  }

  depends_on = [aws_iam_role_policy.gateway]
}

resource "aws_bedrockagentcore_gateway_target" "staff_context" {
  name               = "context"
  gateway_identifier = aws_bedrockagentcore_gateway.staff_context.gateway_id
  description        = "The context layer's lookups, invoked on Lambda by ARN"

  # A Lambda target is invoked with the gateway's own role; a service name is for MCP, OpenAPI and
  # inference targets only, and AgentCore refuses it here.
  credential_provider_configuration {
    gateway_iam_role {}
  }

  target_configuration {
    mcp {
      lambda {
        lambda_arn = data.aws_lambda_function.context.arn
        tool_schema {
          dynamic "inline_payload" {
            for_each = local.tools
            content {
              name        = inline_payload.key
              description = inline_payload.value.description
              input_schema {
                type = "object"
                dynamic "property" {
                  for_each = inline_payload.value.arguments
                  content {
                    name        = property.key
                    type        = property.value.type
                    description = property.value.description
                    required    = true
                  }
                }
              }
            }
          }
        }
      }
    }
  }
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

  # In the platform's private subnets unless NETWORK_MODE=public (network.tf).
  network_configuration {
    network_mode = local.private ? "VPC" : "PUBLIC"
    dynamic "network_mode_config" {
      for_each = local.private ? [1] : []
      content {
        subnets         = local.subnets
        security_groups = [aws_security_group.workload[0].id]
      }
    }
  }

  protocol_configuration {
    server_protocol = "HTTP"
  }

  # Only the api's machine client, with the invoke scope, from the services pool (identity unit).
  authorizer_configuration {
    custom_jwt_authorizer {
      discovery_url   = local.discovery.services
      allowed_clients = [local.service_clients["${local.prefix}-api"]]
      allowed_scopes  = ["undercover-agent/invoke"]
    }
  }

  # An idle session ends after 2 minutes, freeing its connections; /ping keeps it while working, up to 8 hours.
  lifecycle_configuration = [{
    idle_runtime_session_timeout = 120
    max_lifetime                 = 28800
  }]

  environment_variables = {
    ENVIRONMENT      = var.environment
    APP_SECRET       = local.app_parameter
    MODEL_PROVIDER   = var.model_provider
    CONTEXT_AWS_AUTH = "true"
    # The context layer through its gateway, signed for AgentCore, with Gateway's tool names.
    CONTEXT_AWS_SERVICE = "bedrock-agentcore"
    CONTEXT_TOOL_PREFIX = "${aws_bedrockagentcore_gateway_target.context.name}___"
    AGENTCORE_RUNTIME   = "true"
    CLAIM_MODEL         = local.sonnet
    IMPROVER_MODEL      = local.sonnet
    SCREENING_MODEL     = local.haiku
    SPECIALIST_MODEL    = local.haiku
    DRAFTING_MODEL      = local.haiku
    UNDERCOVER_API      = local.api_endpoint
    UNDERCOVER_CONTEXT  = aws_bedrockagentcore_gateway.context.gateway_url
    MEMORY_ID           = aws_bedrockagentcore_memory.customers.id
    KNOWLEDGE_BASE_ID   = aws_bedrockagent_knowledge_base.wording.id
    READ_RECEIPTS       = "true"
    CODE_INTERPRETER_ID = try(aws_bedrockagentcore_code_interpreter.programs[0].code_interpreter_id, "")
    # The agent's workload identity, and the vaulted Anthropic key it fetches with it (none on Bedrock).
    WORKLOAD_NAME          = "${local.prefix}-agent"
    ANTHROPIC_KEY_PROVIDER = local.key_provider
    # Its machine token for the api, in place of the shared key (decision 38).
    API_TOKEN_PROVIDER = "${local.prefix}-api-access"
    #checkov:skip=CKV_SECRET_6: an OAuth scope name, not a secret
    API_TOKEN_SCOPE = "undercover-api/agent"
    # Traces with AWS Distro for OpenTelemetry; the runtime sets the exporter's settings (decision 38).
    AGENT_OBSERVABILITY_ENABLED = "true"
  }

  depends_on = [aws_iam_role_policy.agent, aws_bedrockagentcore_gateway_target.context]

  lifecycle {
    precondition {
      condition     = !local.bedrock || (local.sonnet != "none" && local.haiku != "none")
      error_message = "No Australian inference profile for Claude Sonnet 5.5 or Haiku 5.5 here: turn on model access in the Bedrock console, or set sonnet_model and haiku_model."
    }
  }
}

# Tells the api where the agent runs, and the Copilot where its context gateway is, through the
# app settings they read at start.
resource "terraform_data" "runtime_arn" {
  triggers_replace = [
    aws_bedrockagentcore_agent_runtime.agent.agent_runtime_arn,
    aws_bedrockagentcore_gateway.staff_context.gateway_url,
  ]

  provisioner "local-exec" {
    command = "python3 ${path.module}/../../../scripts/fill-secret.py ${local.app_parameter} AGENT_RUNTIME_ARN=${aws_bedrockagentcore_agent_runtime.agent.agent_runtime_arn} CONTEXT_GATEWAY=${aws_bedrockagentcore_gateway.staff_context.gateway_url}"
  }
}
