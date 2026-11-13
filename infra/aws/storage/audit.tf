# The audit log's seals, write-once (decision 60): each seal the api makes is copied here, and
# S3 Object Lock keeps it from being changed or deleted for a day. Governance mode, not
# compliance, so this prototype's teardown can still empty the bucket (rule 27); production
# would use compliance mode and a longer retention.
resource "aws_s3_bucket" "audit" {
  #checkov:skip=CKV_AWS_18: access logs need a second bucket; CloudTrail data events cover who read what if audits ask
  #checkov:skip=CKV_AWS_144: one region is enough for a demo; real data would replicate within Australia
  #checkov:skip=CKV_AWS_145: the platform's key with ENCRYPTION_KEYS=platform (encryption.tf), S3-managed otherwise
  #checkov:skip=CKV2_AWS_62: nothing reacts to a new seal
  #checkov:skip=CKV2_AWS_61: seals are tiny and kept for the demo's life; no lifecycle needed
  #checkov:skip=CKV_AWS_19: always encrypted below, S3-managed or the platform's key; the check can't follow the condition
  bucket              = "${var.project}-audit-${var.environment}-${data.aws_caller_identity.current.account_id}"
  object_lock_enabled = true
  # Torn down with its seals once their day's retention has passed.
  force_destroy = true
}

resource "aws_s3_bucket_object_lock_configuration" "audit" {
  bucket = aws_s3_bucket.audit.id
  rule {
    default_retention {
      mode = "GOVERNANCE"
      days = 1
    }
  }
}

resource "aws_s3_bucket_public_access_block" "audit" {
  bucket                  = aws_s3_bucket.audit.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "audit" {
  bucket = aws_s3_bucket.audit.id
  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

# trivy:ignore:AWS-0132 the platform's key with ENCRYPTION_KEYS=platform (encryption.tf), S3-managed otherwise
resource "aws_s3_bucket_server_side_encryption_configuration" "audit" {
  bucket = aws_s3_bucket.audit.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = local.data_key == null ? "AES256" : "aws:kms"
      kms_master_key_id = local.data_key
    }
    bucket_key_enabled = local.data_key != null
  }
}

# Object Lock needs versioning; the bucket has it from creation, said here so it stays on.
resource "aws_s3_bucket_versioning" "audit" {
  bucket = aws_s3_bucket.audit.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_policy" "audit" {
  bucket = aws_s3_bucket.audit.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "DenyInsecureTransport"
      Effect    = "Deny"
      Principal = "*"
      Action    = "s3:*"
      Resource  = [aws_s3_bucket.audit.arn, "${aws_s3_bucket.audit.arn}/*"]
      Condition = { Bool = { "aws:SecureTransport" = "false" } }
    }]
  })

  depends_on = [aws_s3_bucket_public_access_block.audit]
}
