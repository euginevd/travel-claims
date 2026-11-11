# One user pool per audience (decisions 10 and 12), email and password, accounts made by an admin.
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
  deletion_protection      = "INACTIVE"

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

# The test accounts the local sign-in offers (STAFF_, CUSTOMER_, REDTEAM_ and ENGINEERING_TEST_ACCOUNTS in the api's main.py).
locals {
  test_accounts = {
    "oliver.grant@example.com"           = "customers"
    "derek.vance@example.com"            = "customers" # the red team's attacker (REDTEAM_TEST_ACCOUNTS)
    "dana.whitfield@undercover.example"  = "staff"
    "marcus.oyelaran@undercover.example" = "staff"
    "sam.carter@undercover.example"      = "engineering"
  }
}

# No password here: the api sets a fresh one at each test sign-in, so none is stored or emailed.
resource "aws_cognito_user" "test" {
  for_each = local.test_accounts

  user_pool_id   = aws_cognito_user_pool.audience[each.value].id
  username       = each.key
  message_action = "SUPPRESS"

  attributes = {
    email          = each.key
    email_verified = "true"
  }
}

resource "aws_cognito_user_in_group" "test" {
  for_each = local.test_accounts

  user_pool_id = aws_cognito_user_pool.audience[each.value].id
  group_name   = aws_cognito_user_group.audience[each.value].name
  username     = aws_cognito_user.test[each.key].username
}
