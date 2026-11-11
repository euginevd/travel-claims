output "urls" {
  description = "Where CloudFront and the agent reach the api and Copilot: the API Gateway endpoint, or the functions' URLs"
  value = local.gateway ? {
    api     = aws_apigatewayv2_api.api[0].api_endpoint
    copilot = aws_apigatewayv2_api.api[0].api_endpoint
    } : merge(
    { for name, url in aws_lambda_function_url.service : name => url.function_url },
    { copilot = aws_lambda_function_url.copilot[0].function_url },
  )
}
