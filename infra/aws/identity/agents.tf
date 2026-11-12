# AgentCore Identity: a workload identity per app that fetches credentials from the token vault,
# and the machine sign-in the api uses to call the agent's runtime (runbook, What's deployed).
data "aws_caller_identity" "current" {}
data "aws_region" "current" {}

locals {
  prefix = "${var.project}-${var.environment}"
}

# Named ${prefix}-<app>; the functions and agent units pass the name to each app as WORKLOAD_NAME.
resource "aws_bedrockagentcore_workload_identity" "app" {
  for_each = toset(["api", "agent", "copilot"])

  name = "${local.prefix}-${each.key}"
}

# Machines, kept apart from people's pools: no users, only the api's client-credentials client.
resource "aws_cognito_user_pool" "services" {
  name                = "${local.prefix}-services"
  user_pool_tier      = "LITE"
  deletion_protection = "INACTIVE"

  admin_create_user_config {
    allow_admin_create_user_only = true
  }
}

# The token endpoint for client credentials needs a domain; it serves no sign-in page anyone uses.
resource "aws_cognito_user_pool_domain" "services" {
  domain       = "${local.prefix}-${data.aws_caller_identity.current.account_id}"
  user_pool_id = aws_cognito_user_pool.services.id
}

resource "aws_cognito_resource_server" "agent" {
  identifier   = "undercover-agent"
  name         = "The claim agent runtime"
  user_pool_id = aws_cognito_user_pool.services.id

  scope {
    scope_name        = "invoke"
    scope_description = "Ask the claim agent to work"
  }
}

# The api's machine identity: an hour-long access token, scoped to invoking the agent only.
resource "aws_cognito_user_pool_client" "api" {
  name                                 = "${local.prefix}-api"
  user_pool_id                         = aws_cognito_user_pool.services.id
  generate_secret                      = true
  allowed_oauth_flows                  = ["client_credentials"]
  allowed_oauth_flows_user_pool_client = true
  allowed_oauth_scopes                 = aws_cognito_resource_server.agent.scope_identifiers
  supported_identity_providers         = ["COGNITO"]
  prevent_user_existence_errors        = "ENABLED"
  enable_token_revocation              = true
  access_token_validity                = 1

  token_validity_units {
    access_token = "hours"
  }
}

# The client's secret lives in the token vault; the api asks AgentCore Identity for a token and
# never holds the secret. Cognito's discovery document names its token endpoint once the domain exists.
resource "aws_bedrockagentcore_oauth2_credential_provider" "agent" {
  name                       = "${local.prefix}-agent-access"
  credential_provider_vendor = "CustomOauth2"

  oauth2_provider_config {
    custom_oauth2_provider_config {
      client_id     = aws_cognito_user_pool_client.api.id
      client_secret = aws_cognito_user_pool_client.api.client_secret

      oauth_discovery {
        discovery_url = "https://cognito-idp.${data.aws_region.current.region}.amazonaws.com/${aws_cognito_user_pool.services.id}/.well-known/openid-configuration"
      }
    }
  }

  depends_on = [aws_cognito_user_pool_domain.services]
}

# The agent's calls back to the api (decision 38): the same pattern the other way, so no shared key
# is left on AWS. The api accepts only access tokens from this client with this scope.
resource "aws_cognito_resource_server" "api" {
  identifier   = "undercover-api"
  name         = "The api agent routes"
  user_pool_id = aws_cognito_user_pool.services.id

  scope {
    scope_name        = "agent"
    scope_description = "Read and record what the claim agent does"
  }
}

resource "aws_cognito_user_pool_client" "agent" {
  name                                 = "${local.prefix}-agent"
  user_pool_id                         = aws_cognito_user_pool.services.id
  generate_secret                      = true
  allowed_oauth_flows                  = ["client_credentials"]
  allowed_oauth_flows_user_pool_client = true
  allowed_oauth_scopes                 = aws_cognito_resource_server.api.scope_identifiers
  supported_identity_providers         = ["COGNITO"]
  prevent_user_existence_errors        = "ENABLED"
  enable_token_revocation              = true
  access_token_validity                = 1

  token_validity_units {
    access_token = "hours"
  }
}

resource "aws_bedrockagentcore_oauth2_credential_provider" "api" {
  name                       = "${local.prefix}-api-access"
  credential_provider_vendor = "CustomOauth2"

  oauth2_provider_config {
    custom_oauth2_provider_config {
      client_id     = aws_cognito_user_pool_client.agent.id
      client_secret = aws_cognito_user_pool_client.agent.client_secret

      oauth_discovery {
        discovery_url = "https://cognito-idp.${data.aws_region.current.region}.amazonaws.com/${aws_cognito_user_pool.services.id}/.well-known/openid-configuration"
      }
    }
  }

  depends_on = [aws_cognito_user_pool_domain.services]
}
