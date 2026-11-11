output "urls" {
  description = "Each function's URL: CloudFront's origins, and the agent's UNDERCOVER_API and UNDERCOVER_CONTEXT"
  value = merge(
    { for name, url in aws_lambda_function_url.service : name => url.function_url },
    { copilot = aws_lambda_function_url.copilot.function_url },
  )
}
