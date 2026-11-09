# One user pool per audience (decisions 10 and 12, spec 35), email and password, accounts made by an admin.
locals {
  audiences = {
    customers   = { group = "customers", description = "Customers of the portal" }
    staff       = { group = "handlers", description = "Claims handlers on the dashboard" }
    engineering = { group = "engineers", description = "AI engineers on the console" }
  }
}

resource "aws_cognito_user_pool" "audience" {
  for_each = local.audiences

  name                     = "${var.project}-${var.environment}-${each.key}"
  user_pool_tier           = "LITE"
  username_attributes      = ["email"]
  auto_verified_attributes = ["email"]
  deletion_protection      = var.environment == "prod" ? "ACTIVE" : "INACTIVE"

  admin_create_user_config {
    allow_admin_create_user_only = true
  }

  password_policy {
    minimum_length                   = 12
    require_lowercase                = true
    require_uppercase                = true
    require_numbers                  = true
    require_symbols                  = true
    temporary_password_validity_days = 3
  }

  account_recovery_setting {
    recovery_mechanism {
      name     = "verified_email"
      priority = 1
    }
  }
}

# The web app's client: no secret, since it runs in the browser; the ID token's audience is its ID.
resource "aws_cognito_user_pool_client" "web" {
  for_each = aws_cognito_user_pool.audience

  name                          = "${var.project}-${var.environment}-${each.key}-web"
  user_pool_id                  = each.value.id
  generate_secret               = false
  explicit_auth_flows           = ["ALLOW_USER_PASSWORD_AUTH", "ALLOW_REFRESH_TOKEN_AUTH"]
  prevent_user_existence_errors = "ENABLED"
  enable_token_revocation       = true
  id_token_validity             = 1
  access_token_validity         = 1
  refresh_token_validity        = 1

  token_validity_units {
    id_token      = "hours"
    access_token  = "hours"
    refresh_token = "days"
  }
}

# The api checks the token's group as well as its issuer and audience.
resource "aws_cognito_user_group" "audience" {
  for_each = aws_cognito_user_pool.audience

  name         = local.audiences[each.key].group
  user_pool_id = each.value.id
  description  = local.audiences[each.key].description
}
