# Bedrock model invocation logging: every Bedrock model call (prompt and answer, text only) kept for
# 30 days in a private bucket that only the deploy role can empty, an audit trail of each AI decision.
# Calls to the Anthropic API (MODEL_PROVIDER=anthropic) aren't Bedrock's, so they aren't logged here.
data "aws_partition" "current" {}
data "aws_region" "current" {}

locals {
  model_logs  = "${var.project}-model-logs-${var.environment}-${local.account}"
  deploy_role = "arn:${data.aws_partition.current.partition}:iam::${local.account}:role/${var.project}-github-deploy"
}

resource "aws_s3_bucket" "model_logs" {
  #checkov:skip=CKV_AWS_18: access logs need a second bucket; CloudTrail's event history covers who changed it
  #checkov:skip=CKV_AWS_144: one region is enough for 30 days of made-up data's logs
  #checkov:skip=CKV_AWS_145: S3-managed encryption is enough for made-up data
  #checkov:skip=CKV2_AWS_62: nothing reacts to a new log
  bucket        = local.model_logs
  force_destroy = true
}

resource "aws_s3_bucket_public_access_block" "model_logs" {
  bucket                  = aws_s3_bucket.model_logs.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "model_logs" {
  bucket = aws_s3_bucket.model_logs.id
  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

# trivy:ignore:AWS-0132 S3-managed encryption is enough for made-up data's logs
resource "aws_s3_bucket_server_side_encryption_configuration" "model_logs" {
  bucket = aws_s3_bucket.model_logs.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_versioning" "model_logs" {
  bucket = aws_s3_bucket.model_logs.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "model_logs" {
  bucket = aws_s3_bucket.model_logs.id

  rule {
    id     = "expire-after-30-days"
    status = "Enabled"
    filter {}
    expiration {
      days = 30
    }
    noncurrent_version_expiration {
      noncurrent_days = 1
    }
    abort_incomplete_multipart_upload {
      days_after_initiation = 1
    }
  }

  depends_on = [aws_s3_bucket_versioning.model_logs]
}

# Bedrock writes from this account only; nobody but the deploy role (at tear down) deletes a log.
resource "aws_s3_bucket_policy" "model_logs" {
  bucket = aws_s3_bucket.model_logs.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "BedrockWrites"
        Effect    = "Allow"
        Principal = { Service = "bedrock.amazonaws.com" }
        Action    = "s3:PutObject"
        Resource  = "${aws_s3_bucket.model_logs.arn}/*"
        Condition = {
          StringEquals = { "aws:SourceAccount" = local.account }
          ArnLike      = { "aws:SourceArn" = "arn:${data.aws_partition.current.partition}:bedrock:${data.aws_region.current.region}:${local.account}:*" }
        }
      },
      {
        Sid       = "NoDeletesButTearDown"
        Effect    = "Deny"
        Principal = "*"
        Action    = ["s3:DeleteObject", "s3:DeleteObjectVersion", "s3:PutLifecycleConfiguration"]
        Resource  = [aws_s3_bucket.model_logs.arn, "${aws_s3_bucket.model_logs.arn}/*"]
        Condition = { ArnNotLike = { "aws:PrincipalArn" = local.deploy_role } }
      },
      {
        Sid       = "DenyInsecureTransport"
        Effect    = "Deny"
        Principal = "*"
        Action    = "s3:*"
        Resource  = [aws_s3_bucket.model_logs.arn, "${aws_s3_bucket.model_logs.arn}/*"]
        Condition = { Bool = { "aws:SecureTransport" = "false" } }
      },
    ]
  })

  depends_on = [aws_s3_bucket_public_access_block.model_logs]
}

resource "aws_bedrock_model_invocation_logging_configuration" "account" {
  logging_config {
    text_data_delivery_enabled      = true
    image_data_delivery_enabled     = false
    embedding_data_delivery_enabled = false
    video_data_delivery_enabled     = false

    s3_config {
      bucket_name = aws_s3_bucket.model_logs.id
      key_prefix  = "bedrock"
    }
  }

  depends_on = [aws_s3_bucket_policy.model_logs]
}
