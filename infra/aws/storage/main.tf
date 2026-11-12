# Customers' receipts: private, encrypted, TLS-only, under the api's random names.
data "aws_caller_identity" "current" {}

resource "aws_s3_bucket" "receipts" {
  #checkov:skip=CKV_AWS_18: access logs need a second bucket; CloudTrail data events cover who read what if audits ask
  #checkov:skip=CKV_AWS_144: one region is enough for a demo; real data would replicate within Australia
  #checkov:skip=CKV_AWS_145: the platform's key with ENCRYPTION_KEYS=platform (encryption.tf), S3-managed otherwise
  #checkov:skip=CKV2_AWS_62: nothing reacts to new receipts but the malware scan (malware.tf)
  #checkov:skip=CKV_AWS_19: always encrypted below, S3-managed or the platform's key; the check can't follow the condition
  bucket = "${var.project}-receipts-${var.environment}-${data.aws_caller_identity.current.account_id}"
  # Torn down with its receipts.
  force_destroy = true
  # Backup=daily: the platform's backup policy selects it by this tag (decision 45).
  tags = { Backup = "daily" }
}

resource "aws_s3_bucket_public_access_block" "receipts" {
  bucket                  = aws_s3_bucket.receipts.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "receipts" {
  bucket = aws_s3_bucket.receipts.id
  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

# trivy:ignore:AWS-0132 the platform's key with ENCRYPTION_KEYS=platform (encryption.tf), S3-managed otherwise
resource "aws_s3_bucket_server_side_encryption_configuration" "receipts" {
  bucket = aws_s3_bucket.receipts.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = local.data_key == null ? "AES256" : "aws:kms"
      kms_master_key_id = local.data_key
    }
    bucket_key_enabled = local.data_key != null
  }
}

resource "aws_s3_bucket_versioning" "receipts" {
  bucket = aws_s3_bucket.receipts.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "receipts" {
  bucket = aws_s3_bucket.receipts.id

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

  depends_on = [aws_s3_bucket_versioning.receipts]
}

resource "aws_s3_bucket_policy" "receipts" {
  bucket = aws_s3_bucket.receipts.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = concat([{
      Sid       = "DenyInsecureTransport"
      Effect    = "Deny"
      Principal = "*"
      Action    = "s3:*"
      Resource  = [aws_s3_bucket.receipts.arn, "${aws_s3_bucket.receipts.arn}/*"]
      Condition = { Bool = { "aws:SecureTransport" = "false" } }
    }], local.malware_statements)
  })

  depends_on = [aws_s3_bucket_public_access_block.receipts]
}
