# Amazon API Gateway in front of the api and the Copilot (decisions 39 and 43), when API_GATEWAY=true:
# a regional REST API with its own WAF, so the rules and rate limit apply to every call, including
# one that skips CloudFront; Cognito authorizers check each audience's token before a function runs,
# with throttling and access logs; the functions then have no URLs. Off (the default), CloudFront
# calls the functions' URLs and the api checks every token itself. The test sign-ins and the project
# page's counts stay open. Access logs need the account's API Gateway logging role, the platform's.
variable "api_gateway" {
  description = "true: the api and Copilot behind an API Gateway REST API with a WAF and no function URLs; false: function URLs"
  type        = bool
  default     = false
}

locals {
  gateway = var.api_gateway
  stage   = var.environment
  # Each audience's pool; the agent's calls back come from the services pool, with its scope.
  pools = merge(
    { for name, prefix in local.audiences : lower(prefix) => one(data.aws_cognito_user_pools.audience[name].arns) },
    { agent = one(data.aws_cognito_user_pools.services.arns) },
  )
  # /api/<area>/{proxy+}: which function and which pool's tokens; dev and demo are open.
  areas = {
    customer    = { target = "api", authorizer = "customer", open = "dev" }
    staff       = { target = "api", authorizer = "staff", open = "dev" }
    engineering = { target = "api", authorizer = "engineering", open = "dev" }
    agent       = { target = "api", authorizer = "agent", open = "" }
    copilot     = { target = "copilot", authorizer = "staff", open = "" }
    demo        = { target = "api", authorizer = "", open = "" }
  }
  open_areas = { for name, area in local.areas : name => area if area.open != "" }
  gateway_functions = {
    api     = aws_lambda_function.service["api"]
    copilot = aws_lambda_function.copilot
  }
  # Where the Copilot (and, through the agent unit, the agent) reaches the api.
  # Built from the API's ID, not the stage, which depends on the Copilot itself.
  api_endpoint = local.gateway ? "https://${aws_api_gateway_rest_api.api[0].id}.execute-api.${local.region}.amazonaws.com/${local.stage}" : trimsuffix(aws_lambda_function_url.service["api"].function_url, "/")
}

resource "aws_api_gateway_rest_api" "api" {
  count = local.gateway ? 1 : 0

  name        = "${local.prefix}-api"
  description = "The ${var.project} api and Copilot, behind Cognito authorizers and a WAF"
  endpoint_configuration {
    types = ["REGIONAL"]
  }
}

resource "aws_api_gateway_authorizer" "cognito" {
  for_each = local.gateway ? local.pools : {}

  name          = each.key
  rest_api_id   = aws_api_gateway_rest_api.api[0].id
  type          = "COGNITO_USER_POOLS"
  provider_arns = [each.value]
}

# /api, /api/<area>, /api/<area>/{proxy+}, and /api/<area>/dev/{proxy+} where it's open.
resource "aws_api_gateway_resource" "api" {
  count = local.gateway ? 1 : 0

  rest_api_id = aws_api_gateway_rest_api.api[0].id
  parent_id   = aws_api_gateway_rest_api.api[0].root_resource_id
  path_part   = "api"
}

resource "aws_api_gateway_resource" "area" {
  for_each = local.gateway ? local.areas : {}

  rest_api_id = aws_api_gateway_rest_api.api[0].id
  parent_id   = aws_api_gateway_resource.api[0].id
  path_part   = each.key
}

resource "aws_api_gateway_resource" "proxy" {
  for_each = local.gateway ? local.areas : {}

  rest_api_id = aws_api_gateway_rest_api.api[0].id
  parent_id   = aws_api_gateway_resource.area[each.key].id
  path_part   = "{proxy+}"
}

resource "aws_api_gateway_resource" "open" {
  for_each = local.gateway ? local.open_areas : {}

  rest_api_id = aws_api_gateway_rest_api.api[0].id
  parent_id   = aws_api_gateway_resource.area[each.key].id
  path_part   = each.value.open
}

resource "aws_api_gateway_resource" "open_proxy" {
  for_each = local.gateway ? local.open_areas : {}

  rest_api_id = aws_api_gateway_rest_api.api[0].id
  parent_id   = aws_api_gateway_resource.open[each.key].id
  path_part   = "{proxy+}"
}

resource "aws_api_gateway_method" "proxy" {
  #checkov:skip=CKV_AWS_59: the demo's counts are open; every other area has a Cognito authorizer
  #checkov:skip=CKV2_AWS_53: the api validates every request body itself
  for_each = local.gateway ? local.areas : {}

  rest_api_id          = aws_api_gateway_rest_api.api[0].id
  resource_id          = aws_api_gateway_resource.proxy[each.key].id
  http_method          = "ANY"
  authorization        = each.value.authorizer == "" ? "NONE" : "COGNITO_USER_POOLS"
  authorizer_id        = each.value.authorizer == "" ? null : aws_api_gateway_authorizer.cognito[each.value.authorizer].id
  authorization_scopes = each.value.authorizer == "agent" ? ["undercover-api/agent"] : null
}

resource "aws_api_gateway_method" "open_proxy" {
  #checkov:skip=CKV_AWS_59: the demo's test sign-ins, open by design (TEST_SIGN_IN)
  #checkov:skip=CKV2_AWS_53: the api validates every request body itself
  for_each = local.gateway ? local.open_areas : {}

  rest_api_id   = aws_api_gateway_rest_api.api[0].id
  resource_id   = aws_api_gateway_resource.open_proxy[each.key].id
  http_method   = "ANY"
  authorization = "NONE"
}

resource "aws_api_gateway_integration" "proxy" {
  for_each = local.gateway ? local.areas : {}

  rest_api_id             = aws_api_gateway_rest_api.api[0].id
  resource_id             = aws_api_gateway_resource.proxy[each.key].id
  http_method             = aws_api_gateway_method.proxy[each.key].http_method
  type                    = "AWS_PROXY"
  integration_http_method = "POST"
  uri                     = local.gateway_functions[each.value.target].invoke_arn
}

resource "aws_api_gateway_integration" "open_proxy" {
  for_each = local.gateway ? local.open_areas : {}

  rest_api_id             = aws_api_gateway_rest_api.api[0].id
  resource_id             = aws_api_gateway_resource.open_proxy[each.key].id
  http_method             = aws_api_gateway_method.open_proxy[each.key].http_method
  type                    = "AWS_PROXY"
  integration_http_method = "POST"
  uri                     = local.gateway_functions[each.value.target].invoke_arn
}

resource "aws_api_gateway_deployment" "api" {
  count = local.gateway ? 1 : 0

  rest_api_id = aws_api_gateway_rest_api.api[0].id
  # A new deployment whenever a route, method or integration changes.
  triggers = {
    routes = sha1(jsonencode([local.areas, aws_api_gateway_integration.proxy, aws_api_gateway_integration.open_proxy]))
  }

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_cloudwatch_log_group" "api_access" {
  #checkov:skip=CKV_AWS_158: AWS-owned encryption is enough for access logs
  #checkov:skip=CKV_AWS_338: 30 days; the platform's log archive keeps the long record
  count = local.gateway ? 1 : 0

  name              = "/aws/vendedlogs/${local.prefix}-api-access"
  retention_in_days = 30
}

resource "aws_api_gateway_stage" "api" {
  #checkov:skip=CKV_AWS_120: responses are per person, so nothing is cached
  #checkov:skip=CKV_AWS_73: AgentCore Observability traces the agent; the api's calls are in the access logs
  #checkov:skip=CKV2_AWS_51: callers authenticate with Cognito tokens, not client certificates
  #checkov:skip=CKV2_AWS_77: the WAF has AWSManagedRulesKnownBadInputsRuleSet (Log4j); the check can't follow its dynamic rules
  count = local.gateway ? 1 : 0

  rest_api_id   = aws_api_gateway_rest_api.api[0].id
  deployment_id = aws_api_gateway_deployment.api[0].id
  stage_name    = local.stage

  access_log_settings {
    destination_arn = aws_cloudwatch_log_group.api_access[0].arn
    format = jsonencode({
      requestId = "$context.requestId", ip = "$context.identity.sourceIp", time = "$context.requestTime"
      method    = "$context.httpMethod", path = "$context.resourcePath", status = "$context.status"
      latency   = "$context.integrationLatency", authorizerError = "$context.authorizer.error"
      waf       = "$context.wafResponseCode"
    })
  }
}

# A ceiling for the whole API; each claim is a handful of calls.
resource "aws_api_gateway_method_settings" "all" {
  #checkov:skip=CKV_AWS_225: responses are per person, so nothing is cached
  count = local.gateway ? 1 : 0

  rest_api_id = aws_api_gateway_rest_api.api[0].id
  stage_name  = aws_api_gateway_stage.api[0].stage_name
  method_path = "*/*"

  settings {
    throttling_burst_limit = 100
    throttling_rate_limit  = 50
    metrics_enabled        = true
    logging_level          = "ERROR"
  }
}

# The API's own WAF: AWS's managed rules and a rate limit per IP, on every call however it arrives.
resource "aws_wafv2_web_acl" "api" {
  #checkov:skip=CKV2_AWS_31: request logging is the platform's, through Firewall Manager
  count = local.gateway ? 1 : 0

  name  = "${local.prefix}-api"
  scope = "REGIONAL"

  default_action {
    allow {}
  }

  dynamic "rule" {
    for_each = { AWSManagedRulesCommonRuleSet = 1, AWSManagedRulesKnownBadInputsRuleSet = 2, AWSManagedRulesAmazonIpReputationList = 3 }
    content {
      name     = rule.key
      priority = rule.value
      override_action {
        none {}
      }
      statement {
        managed_rule_group_statement {
          name        = rule.key
          vendor_name = "AWS"
        }
      }
      visibility_config {
        cloudwatch_metrics_enabled = true
        metric_name                = "${local.prefix}-api-${rule.key}"
        sampled_requests_enabled   = true
      }
    }
  }

  rule {
    name     = "rate-limit"
    priority = 4
    action {
      block {}
    }
    statement {
      rate_based_statement {
        limit              = 1000
        aggregate_key_type = "IP"
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${local.prefix}-api-rate-limit"
      sampled_requests_enabled   = true
    }
  }

  visibility_config {
    cloudwatch_metrics_enabled = true
    metric_name                = "${local.prefix}-api"
    sampled_requests_enabled   = true
  }
}

resource "aws_wafv2_web_acl_association" "api" {
  count = local.gateway ? 1 : 0

  resource_arn = aws_api_gateway_stage.api[0].arn
  web_acl_arn  = aws_wafv2_web_acl.api[0].arn
}

resource "aws_lambda_permission" "gateway" {
  for_each = local.gateway ? local.gateway_functions : {}

  statement_id  = "api-gateway"
  action        = "lambda:InvokeFunction"
  function_name = each.value.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_api_gateway_rest_api.api[0].execution_arn}/*/*"
}
