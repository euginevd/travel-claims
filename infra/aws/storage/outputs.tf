output "receipts_bucket" {
  description = "RECEIPTS_BUCKET for the api"
  value       = aws_s3_bucket.receipts.bucket
}

output "audit_bucket" {
  description = "AUDIT_BUCKET for the api: the audit seals' write-once copy"
  value       = aws_s3_bucket.audit.bucket
}
