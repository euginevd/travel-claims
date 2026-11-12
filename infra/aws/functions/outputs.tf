output "urls" {
  description = "Where CloudFront and the agent reach the api and Copilot: the API Gateway endpoint, or the functions' URLs"
  value = local.gateway ? {
    api     = aws_api_gateway_stage.api[0].invoke_url
    copilot = aws_api_gateway_stage.api[0].invoke_url
    } : merge(
    { for name, url in aws_lambda_function_url.service : name => url.function_url },
    { copilot = aws_lambda_function_url.copilot[0].function_url },
  )
}
