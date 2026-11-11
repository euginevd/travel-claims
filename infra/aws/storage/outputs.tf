output "receipts_bucket" {
  description = "RECEIPTS_BUCKET for the api"
  value       = aws_s3_bucket.receipts.bucket
}
