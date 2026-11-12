# Personal data masked in the functions' logs (decision 45), when LOG_MASKING=true: a CloudWatch Logs
# data protection policy finds emails, card details and AWS secret keys and masks them, a backstop to
# the apps' own redaction (spec 25). Off (the default): no policy.
variable "log_masking" {
  description = "true: mask personal data and secrets in the functions' logs"
  type        = bool
  default     = false
}

locals {
  masked = [for id in ["EmailAddress", "CreditCardNumber", "CreditCardExpiration", "CreditCardSecurityCode", "AwsSecretKey"] :
  "arn:${local.partition}:dataprotection::aws:data-identifier/${id}"]
}

resource "aws_cloudwatch_log_data_protection_policy" "function" {
  for_each = var.log_masking ? local.functions : {}

  log_group_name = aws_cloudwatch_log_group.function[each.key].name
  policy_document = jsonencode({
    Name    = "${local.prefix}-${each.key}-masking"
    Version = "2021-06-01"
    Statement = [
      {
        Sid            = "Audit"
        DataIdentifier = local.masked
        Operation      = { Audit = { FindingsDestination = {} } }
      },
      {
        Sid            = "Mask"
        DataIdentifier = local.masked
        Operation      = { Deidentify = { MaskConfig = {} } }
      },
    ]
  })
}
