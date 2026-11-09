output "urls" {
  description = "Each web app's address"
  value       = { for app, dist in aws_cloudfront_distribution.web : app => "https://${dist.domain_name}" }
}
