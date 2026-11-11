# One SecureString parameter of JSON settings per environment (decision 30); written by script, so no value is in state.
locals {
  name   = "/${var.project}/${var.environment}/app"
  script = "${path.module}/../../../scripts/fill-secret.py"
  keys   = "${path.module}/../../../scripts/api-key-provider.py"
  # The Anthropic key's provider in the token vault; the agent and functions units name it too.
  key_provider = "${var.project}-${var.environment}-anthropic"
}

# Deletes the parameter on destroy, and only then.
resource "terraform_data" "app" {
  input = local.name

  provisioner "local-exec" {
    when    = destroy
    command = "python3 ${path.module}/../../../scripts/fill-secret.py --delete ${self.input}"
  }
}

# Creates it with the agent's key and adds what's missing, never overwriting a value.
resource "terraform_data" "fill" {
  triggers_replace = [terraform_data.app.input, filesha256(local.script)]

  provisioner "local-exec" {
    command = "python3 ${local.script} ${terraform_data.app.input}"
  }
}

# MODEL_PROVIDER=anthropic: the key into AgentCore Identity's token vault, where only the agent's and
# Copilot's workload identities fetch it, and the workspace into the settings; both from GitHub
# secrets in the environment, never from state.
resource "terraform_data" "anthropic" {
  count = var.model_provider == "anthropic" ? 1 : 0

  triggers_replace = [terraform_data.fill.id, var.anthropic_key_version]

  provisioner "local-exec" {
    command = "python3 ${local.keys} ${local.key_provider} --from-env ANTHROPIC_API_KEY && python3 ${local.script} ${terraform_data.app.input} --from-env ANTHROPIC_WORKSPACE_ID --remove ANTHROPIC_API_KEY"
  }
}

# Deletes the vaulted key on destroy, and only then.
resource "terraform_data" "anthropic_provider" {
  input = local.key_provider

  provisioner "local-exec" {
    when    = destroy
    command = "python3 ${path.module}/../../../scripts/api-key-provider.py --delete ${self.input}"
  }
}

# MODEL_PROVIDER=bedrock: no Anthropic key is kept, in the vault or the settings.
resource "terraform_data" "bedrock_only" {
  count = var.model_provider == "bedrock" ? 1 : 0

  triggers_replace = [terraform_data.fill.id]

  provisioner "local-exec" {
    command = "python3 ${local.keys} --delete ${local.key_provider} && python3 ${local.script} ${terraform_data.app.input} --remove ANTHROPIC_API_KEY ANTHROPIC_WORKSPACE_ID"
  }
}
