# A Bedrock guardrail for Claude's calls (spec 36), named to the apps through the app secret when enabled.
locals {
  prefix = "${var.project}-${var.environment}"
}

data "aws_secretsmanager_secret" "app" {
  name = "${var.project}/${var.environment}/app"
}

resource "aws_bedrock_guardrail" "claims" {
  name                      = "${local.prefix}-claims"
  description               = "Screens model calls for the ${var.project} agent and copilot"
  blocked_input_messaging   = "This request can't be processed."
  blocked_outputs_messaging = "This answer can't be shown."

  # Harmful content in or out; prompt attacks on the way in, beside the app's own hidden-instruction check.
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

resource "terraform_data" "enable" {
  count = var.enabled ? 1 : 0

  triggers_replace = [aws_bedrock_guardrail_version.claims.version]

  provisioner "local-exec" {
    command = "python3 ${path.module}/../../scripts/fill-secret.py ${data.aws_secretsmanager_secret.app.name} BEDROCK_GUARDRAIL_ID=${aws_bedrock_guardrail.claims.guardrail_id} BEDROCK_GUARDRAIL_VERSION=${aws_bedrock_guardrail_version.claims.version}"
  }
}
