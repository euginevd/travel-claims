# Bedrock guardrails named to the agent through the app settings when enabled: one on customer text
# before any model reads it, and two on what the models write before anyone sees it.
locals {
  prefix        = "${var.project}-${var.environment}"
  app_parameter = "/${var.project}/${var.environment}/app"
}

resource "aws_bedrock_guardrail" "claims" {
  name                      = "${local.prefix}-claims"
  description               = "Screens customer text for the ${var.project} agent before any model reads it"
  blocked_input_messaging   = "This request can't be processed."
  blocked_outputs_messaging = "This answer can't be shown."

  # Harmful content and prompt attacks in the customer's text, ahead of the app's own hidden-instruction check.
  content_policy_config {
    dynamic "filters_config" {
      for_each = toset(["HATE", "INSULTS", "SEXUAL", "VIOLENCE", "MISCONDUCT"])
      content {
        type            = filters_config.value
        input_strength  = "MEDIUM"
        output_strength = "MEDIUM"
      }
    }
    filters_config {
      type            = "PROMPT_ATTACK"
      input_strength  = "HIGH"
      output_strength = "NONE"
    }
  }
}

# A numbered version, so a change to the guardrail is a reviewed apply, not a live edit.
resource "aws_bedrock_guardrail_version" "claims" {
  guardrail_arn = aws_bedrock_guardrail.claims.guardrail_arn
  description   = "Applied by Terraform"
}

# Ask UnderCover's answers: each must rest on the wording and records the assistant read, and answer
# the question asked. A separate guardrail, so the check never runs without its source and query.
resource "aws_bedrock_guardrail" "answers" {
  name                      = "${local.prefix}-answers"
  description               = "Checks the ${var.project} assistant's answers are grounded in what it read"
  blocked_input_messaging   = "This request can't be processed."
  blocked_outputs_messaging = "This answer can't be shown."

  contextual_grounding_policy_config {
    filters_config {
      type      = "GROUNDING"
      threshold = 0.75
    }
    filters_config {
      type      = "RELEVANCE"
      threshold = 0.5
    }
  }
}

resource "aws_bedrock_guardrail_version" "answers" {
  guardrail_arn = aws_bedrock_guardrail.answers.guardrail_arn
  description   = "Applied by Terraform"
}

# Letters and claim drafts: blocked when they carry card, bank, tax, passport or access-key numbers,
# which no letter or draft needs. Names, emails and phones are left to the handler who reads the
# letter, since the guardrail can't tell the customer's own from anyone else's.
resource "aws_bedrock_guardrail" "letters" {
  name                      = "${local.prefix}-letters"
  description               = "Keeps card, bank, tax and identity numbers out of the ${var.project} agent's letters and drafts"
  blocked_input_messaging   = "This request can't be processed."
  blocked_outputs_messaging = "This letter can't be shown."

  sensitive_information_policy_config {
    # Only types a letter never needs; dates, amounts and claim numbers would trip PIN or expiry.
    dynamic "pii_entities_config" {
      for_each = toset([
        "CREDIT_DEBIT_CARD_NUMBER",
        "PASSWORD",
        "INTERNATIONAL_BANK_ACCOUNT_NUMBER",
        "US_BANK_ACCOUNT_NUMBER",
        "US_PASSPORT_NUMBER",
        "US_SOCIAL_SECURITY_NUMBER",
        "AWS_ACCESS_KEY",
        "AWS_SECRET_KEY",
      ])
      content {
        type   = pii_entities_config.value
        action = "BLOCK"
      }
    }
    # Australian numbers the built-in types miss: a tax file number (123 456 789), a BSB with an
    # account number (062-000 12345678) and a passport number (PA1234567).
    regexes_config {
      name        = "tax-file-number"
      description = "An Australian tax file number"
      pattern     = "\\b\\d{3}[ -]\\d{3}[ -]\\d{3}\\b"
      action      = "BLOCK"
    }
    regexes_config {
      name        = "bsb-and-account"
      description = "An Australian BSB followed by an account number"
      pattern     = "\\b\\d{3}-\\d{3}[ ,]+\\d{6,10}\\b"
      action      = "BLOCK"
    }
    regexes_config {
      name        = "australian-passport"
      description = "An Australian passport number"
      pattern     = "\\b[A-Z]{1,2}\\d{7}\\b"
      action      = "BLOCK"
    }
  }
}

resource "aws_bedrock_guardrail_version" "letters" {
  guardrail_arn = aws_bedrock_guardrail.letters.guardrail_arn
  description   = "Applied by Terraform"
}

resource "terraform_data" "enable" {
  count = var.enabled ? 1 : 0

  triggers_replace = [
    aws_bedrock_guardrail_version.claims.version,
    aws_bedrock_guardrail_version.answers.version,
    aws_bedrock_guardrail_version.letters.version,
  ]

  provisioner "local-exec" {
    command = join(" ", [
      "python3 ${path.module}/../../../scripts/fill-secret.py ${local.app_parameter}",
      "BEDROCK_GUARDRAIL_ID=${aws_bedrock_guardrail.claims.guardrail_id}",
      "BEDROCK_GUARDRAIL_VERSION=${aws_bedrock_guardrail_version.claims.version}",
      "BEDROCK_ANSWER_GUARDRAIL_ID=${aws_bedrock_guardrail.answers.guardrail_id}",
      "BEDROCK_ANSWER_GUARDRAIL_VERSION=${aws_bedrock_guardrail_version.answers.version}",
      "BEDROCK_LETTER_GUARDRAIL_ID=${aws_bedrock_guardrail.letters.guardrail_id}",
      "BEDROCK_LETTER_GUARDRAIL_VERSION=${aws_bedrock_guardrail_version.letters.version}",
    ])
  }
}
