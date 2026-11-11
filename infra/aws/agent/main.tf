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
      # The context layer only through its gateway, which alone may call the context's URL.
      { Effect = "Allow", Action = "bedrock-agentcore:InvokeGateway", Resource = aws_bedrockagentcore_gateway.context.gateway_arn },
      # The customers' memory: write a decided claim's record, list one customer's.
      { Effect = "Allow", Action = ["bedrock-agentcore:BatchCreateMemoryRecords", "bedrock-agentcore:ListMemoryRecords"], Resource = aws_bedrockagentcore_memory.customers.arn },
      # Ask UnderCover searches the policy wording in its knowledge base.
      { Effect = "Allow", Action = "bedrock:Retrieve", Resource = aws_bedrockagent_knowledge_base.wording.arn },
      ],
      # Lookup programs, only while they're on: one short session each on their own interpreter.
      [for ci in aws_bedrockagentcore_code_interpreter.programs : {
        Effect   = "Allow"
        Action   = ["bedrock-agentcore:StartCodeInterpreterSession", "bedrock-agentcore:InvokeCodeInterpreter", "bedrock-agentcore:StopCodeInterpreterSession"]
        Resource = ci.code_interpreter_arn
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

  # Public, so a program can reach the gateway; its role can call nothing else.
  network_configuration {
    network_mode = "PUBLIC"
  }

  depends_on = [aws_iam_role_policy.programs]
}

# AgentCore Gateway in front of the context layer (plan phase 3): the agent reaches its lookups as
# managed MCP tools, and the gateway signs each call to the context's IAM-only URL with its own role.
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
      # The context's URL takes only IAM-signed calls, and only this role may make them.
      {
        Effect    = "Allow"
        Action    = ["lambda:InvokeFunctionUrl", "lambda:InvokeFunction"]
        Resource  = "arn:${local.partition}:lambda:${local.region}:${local.account}:function:${local.prefix}-context"
        Condition = { StringEquals = { "lambda:FunctionUrlAuthType" = "AWS_IAM" } }
      },
    ]
  })
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

  depends_on = [aws_iam_role_policy.gateway]
}

# Gateway names each tool after this target: context___get_claim_rules.
resource "aws_bedrockagentcore_gateway_target" "context" {
  name               = "context"
  gateway_identifier = aws_bedrockagentcore_gateway.context.gateway_id
  description        = "The context layer's MCP server on Lambda"

  credential_provider_configuration {
    gateway_iam_role {
      service = "lambda"
    }
  }

  target_configuration {
    mcp {
      mcp_server {
        endpoint = "${trimsuffix(data.aws_lambda_function_url.context.function_url, "/")}/mcp"
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
    ENVIRONMENT      = var.environment
    APP_SECRET       = data.aws_secretsmanager_secret.app.name
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
    UNDERCOVER_API      = trimsuffix(data.aws_lambda_function_url.api.function_url, "/")
    UNDERCOVER_CONTEXT  = aws_bedrockagentcore_gateway.context.gateway_url
    MEMORY_ID           = aws_bedrockagentcore_memory.customers.id
    KNOWLEDGE_BASE_ID   = aws_bedrockagent_knowledge_base.wording.id
    CODE_INTERPRETER_ID = try(aws_bedrockagentcore_code_interpreter.programs[0].code_interpreter_id, "")
  }

  depends_on = [aws_iam_role_policy.agent, aws_bedrockagentcore_gateway_target.context]

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
    command = "python3 ${path.module}/../../../scripts/fill-secret.py ${data.aws_secretsmanager_secret.app.name} AGENT_RUNTIME_ARN=${aws_bedrockagentcore_agent_runtime.agent.agent_runtime_arn}"
  }
}
