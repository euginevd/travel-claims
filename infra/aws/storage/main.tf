# Customers' receipts: private, encrypted, TLS-only, under the api's random names.
data "aws_caller_identity" "current" {}

resource "aws_s3_bucket" "receipts" {
  #checkov:skip=CKV_AWS_18: access logs need a second bucket; CloudTrail data events cover who read what if audits ask
  #checkov:skip=CKV_AWS_144: one region is enough for a demo; real data would replicate within Australia
  #checkov:skip=CKV_AWS_145: S3-managed encryption is enough for made-up receipts; real data would take a customer key
  #checkov:skip=CKV2_AWS_62: nothing reacts to new receipts; the api reads them when asked
  bucket = "${var.project}-receipts-${var.environment}-${data.aws_caller_identity.current.account_id}"
  # Torn down with its receipts.
  force_destroy = true
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

# trivy:ignore:AWS-0132 S3-managed encryption is enough for made-up receipts; real data would take a customer key
resource "aws_s3_bucket_server_side_encryption_configuration" "receipts" {
  bucket = aws_s3_bucket.receipts.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
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
    Statement = [{
      Sid       = "DenyInsecureTransport"
      Effect    = "Deny"
      Principal = "*"
      Action    = "s3:*"
      Resource  = [aws_s3_bucket.receipts.arn, "${aws_s3_bucket.receipts.arn}/*"]
      Condition = { Bool = { "aws:SecureTransport" = "false" } }
    }]
  })

  depends_on = [aws_s3_bucket_public_access_block.receipts]
}
