# Staff sign-in through IAM Identity Center (SAML), for the handlers' and the AI engineers' pools,
# when the pipeline names its metadata URL. Customers keep their own pool's email and password.
locals {
  sso_provider = "IdentityCenter"
  sso_pools    = var.staff_saml_metadata_url == "" ? toset([]) : toset(["staff", "engineering"])
  sso_urls     = [for url in split(",", var.staff_sign_in_urls) : trimspace(url) if trimspace(url) != ""]
  boundary     = "arn:${data.aws_partition.current.partition}:iam::${data.aws_caller_identity.current.account_id}:policy/${var.project}-boundary"
}

data "aws_partition" "current" {}

resource "aws_cognito_identity_provider" "sso" {
  for_each = local.sso_pools

  user_pool_id  = aws_cognito_user_pool.audience[each.key].id
  provider_name = local.sso_provider
  provider_type = "SAML"

  provider_details = {
    MetadataURL = var.staff_saml_metadata_url
  }

  # Identity Center's application sends these attribute names; groups may hold several values.
  attribute_mapping = {
    email           = "email"
    "custom:groups" = "groups"
  }
}

# The hosted sign-in page the apps send people to, and its token endpoint.
resource "aws_cognito_user_pool_domain" "sso" {
  for_each = local.sso_pools

  domain       = "${local.prefix}-${each.key}-${data.aws_caller_identity.current.account_id}"
  user_pool_id = aws_cognito_user_pool.audience[each.key].id
}

# The trigger that turns a federated person's Identity Center groups into cognito:groups, kept to
# the pool's own group; the code is the api's, since those are the api's gates.
data "archive_file" "sso_groups" {
  count = length(local.sso_pools) > 0 ? 1 : 0

  type        = "zip"
  source_file = "${path.module}/../../../apps/api/src/undercover_api/sso_groups.py"
  output_path = "${path.module}/.terraform/sso_groups.zip"
}

resource "aws_iam_role" "sso_groups" {
  count = length(local.sso_pools) > 0 ? 1 : 0

  name                 = "${var.project}-identity-sso-groups-${var.environment}"
  permissions_boundary = local.boundary
  assume_role_policy = jsonencode({
    Version   = "2012-10-17"
    Statement = [{ Effect = "Allow", Action = "sts:AssumeRole", Principal = { Service = "lambda.amazonaws.com" } }]
  })
}

resource "aws_iam_role_policy" "sso_groups" {
  count = length(local.sso_pools) > 0 ? 1 : 0

  name = "logs"
  role = aws_iam_role.sso_groups[0].id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["logs:CreateLogStream", "logs:PutLogEvents"]
      Resource = [for name in local.sso_pools : "${aws_cloudwatch_log_group.sso_groups[name].arn}:*"]
    }]
  })
}

resource "aws_cloudwatch_log_group" "sso_groups" {
  #checkov:skip=CKV_AWS_338: a sign-in trigger's logs, kept 14 days like the functions'
  #checkov:skip=CKV_AWS_158: AWS-owned encryption is enough for these logs
  for_each = local.sso_pools

  name              = "/aws/lambda/${var.project}-identity-${each.key}-groups-${var.environment}"
  retention_in_days = 14
}

resource "aws_lambda_function" "sso_groups" {
  #checkov:skip=CKV_AWS_173: the environment holds group names, not secrets
  #checkov:skip=CKV_AWS_272: code signing is for shipped packages; this is one file zipped from the repo at apply
  #checkov:skip=CKV_AWS_117: it reaches nothing; Cognito calls it and it only reads the event
  #checkov:skip=CKV_AWS_115: Cognito's sign-ins cap its load
  #checkov:skip=CKV_AWS_116: called synchronously by Cognito, so a dead-letter queue never receives anything
  #checkov:skip=CKV_AWS_50: a few lines with no calls out; nothing to trace
  for_each = local.sso_pools

  function_name    = "${var.project}-identity-${each.key}-groups-${var.environment}"
  role             = aws_iam_role.sso_groups[0].arn
  runtime          = "python3.14"
  handler          = "sso_groups.handler"
  filename         = data.archive_file.sso_groups[0].output_path
  source_code_hash = data.archive_file.sso_groups[0].output_base64sha256
  timeout          = 5
  memory_size      = 128

  environment {
    variables = {
      PROVIDER       = local.sso_provider
      ALLOWED_GROUPS = local.audiences[each.key].group
      GROUP_IDS      = var.staff_sso_group_ids
    }
  }

  depends_on = [aws_iam_role_policy.sso_groups, aws_cloudwatch_log_group.sso_groups]
}

resource "aws_lambda_permission" "sso_groups" {
  for_each = local.sso_pools

  statement_id  = "AllowCognito"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.sso_groups[each.key].function_name
  principal     = "cognito-idp.amazonaws.com"
  source_arn    = aws_cognito_user_pool.audience[each.key].arn
}
