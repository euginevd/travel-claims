# Amazon API Gateway in front of the api and the Copilot (decision 39), when API_GATEWAY=true: an
# HTTP API whose JWT authorizers check each audience's Cognito token before a request reaches a
# function, with throttling and access logs; the functions then have no URLs, so nothing reaches
# them except through it. Off (the default), CloudFront calls the functions' URLs and the api checks
# every token itself, as before. The test sign-ins and the project page's counts stay open.
variable "api_gateway" {
  description = "true: the api and Copilot behind an API Gateway HTTP API with no function URLs; false: function URLs"
  type        = bool
  default     = false
}

locals {
  gateway = var.api_gateway
  # Which pool's tokens each route takes, and the audience (an app client) it must name.
  authorizers = merge(
    {
      for name, prefix in local.audiences : lower(prefix) => {
        issuer   = local.issuers["${prefix}_TOKEN_ISSUER"]
        audience = local.token_audiences["${prefix}_TOKEN_AUDIENCE"]
      }
    },
    # The agent's calls back: its machine client's access tokens (decision 38).
    { agent = { issuer = local.agent_caller_issuer, audience = local.agent_caller_client } },
  )
  routes = {
    "ANY /api/customer/{proxy+}"    = { target = "api", authorizer = "customer" }
    "ANY /api/staff/{proxy+}"       = { target = "api", authorizer = "staff" }
    "ANY /api/engineering/{proxy+}" = { target = "api", authorizer = "engineering" }
    "ANY /api/agent/{proxy+}"       = { target = "api", authorizer = "agent" }
    "ANY /api/copilot/{proxy+}"     = { target = "copilot", authorizer = "staff" }
    # Open: the demo's test sign-ins (TEST_SIGN_IN) and the project page's counts.
    "ANY /api/customer/dev/{proxy+}"    = { target = "api", authorizer = "" }
    "ANY /api/staff/dev/{proxy+}"       = { target = "api", authorizer = "" }
    "ANY /api/engineering/dev/{proxy+}" = { target = "api", authorizer = "" }
    "ANY /api/demo/{proxy+}"            = { target = "api", authorizer = "" }
  }
  gateway_functions = {
    api     = aws_lambda_function.service["api"]
    copilot = aws_lambda_function.copilot
  }
  # Where the Copilot (and, through the agent unit, the agent) reaches the api.
  api_endpoint = local.gateway ? aws_apigatewayv2_api.api[0].api_endpoint : trimsuffix(aws_lambda_function_url.service["api"].function_url, "/")
}

resource "aws_apigatewayv2_api" "api" {
  count = local.gateway ? 1 : 0

  name          = "${local.prefix}-api"
  description   = "The ${var.project} api and Copilot, behind JWT authorizers"
  protocol_type = "HTTP"
}

resource "aws_apigatewayv2_authorizer" "jwt" {
  for_each = local.gateway ? local.authorizers : {}

  api_id           = aws_apigatewayv2_api.api[0].id
  name             = each.key
  authorizer_type  = "JWT"
  identity_sources = ["$request.header.Authorization"]

  jwt_configuration {
    issuer   = each.value.issuer
    audience = [each.value.audience]
  }
}

resource "aws_apigatewayv2_integration" "function" {
  for_each = local.gateway ? local.gateway_functions : {}

  api_id                 = aws_apigatewayv2_api.api[0].id
  integration_type       = "AWS_PROXY"
  integration_uri        = each.value.invoke_arn
  payload_format_version = "2.0"
  timeout_milliseconds   = 30000
}

resource "aws_apigatewayv2_route" "route" {
  #checkov:skip=CKV_AWS_309: the open routes are the demo's test sign-ins and public counts; every other route has a JWT authorizer
  for_each = local.gateway ? local.routes : {}

  api_id               = aws_apigatewayv2_api.api[0].id
  route_key            = each.key
  target               = "integrations/${aws_apigatewayv2_integration.function[each.value.target].id}"
  authorization_type   = each.value.authorizer == "" ? "NONE" : "JWT"
  authorizer_id        = each.value.authorizer == "" ? null : aws_apigatewayv2_authorizer.jwt[each.value.authorizer].id
  authorization_scopes = each.value.authorizer == "agent" ? ["undercover-api/agent"] : null
}

resource "aws_cloudwatch_log_group" "api_access" {
  #checkov:skip=CKV_AWS_158: AWS-owned encryption is enough for made-up data's access logs
  #checkov:skip=CKV_AWS_338: 30 days is enough for dev
  count = local.gateway ? 1 : 0

  name              = "/aws/vendedlogs/${local.prefix}-api-access"
  retention_in_days = 30
}

resource "aws_apigatewayv2_stage" "default" {
  count = local.gateway ? 1 : 0

  api_id      = aws_apigatewayv2_api.api[0].id
  name        = "$default"
  auto_deploy = true

  # A ceiling for the whole API; each claim is a handful of calls.
  default_route_settings {
    throttling_burst_limit = 100
    throttling_rate_limit  = 50
  }

  access_log_settings {
    destination_arn = aws_cloudwatch_log_group.api_access[0].arn
    format = jsonencode({
      requestId = "$context.requestId", ip = "$context.identity.sourceIp", time = "$context.requestTime"
      method    = "$context.httpMethod", route = "$context.routeKey", status = "$context.status"
      latency   = "$context.integrationLatency", authorizerError = "$context.authorizer.error"
    })
  }
}

resource "aws_lambda_permission" "gateway" {
  for_each = local.gateway ? local.gateway_functions : {}

  statement_id  = "api-gateway"
  action        = "lambda:InvokeFunction"
  function_name = each.value.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.api[0].execution_arn}/*/*"
}
