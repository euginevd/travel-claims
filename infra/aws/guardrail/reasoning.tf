# Ask UnderCover's Automated Reasoning check (decision 48): formal rules built from the policy
# wording, and a guardrail that checks answers against them, kept by scripts/reasoning-policy.py
# as the Terraform provider has no Automated Reasoning resources yet. A changed wording or script
# rebuilds both; tear down deletes them. In Sydney it processes only in Australia.
locals {
  wording   = "${path.module}/../../../apps/context/src/undercover_context/data/policy_wording.md"
  reasoning = "${path.module}/../../../scripts/reasoning-policy.py"
}

resource "terraform_data" "reasoning" {
  count = var.enabled ? 1 : 0

  triggers_replace = [filesha256(local.wording), filesha256(local.reasoning)]

  # A destroy provisioner sees only its own resource, so what delete needs is kept here.
  input = {
    name      = "${local.prefix}-reasoning"
    parameter = local.app_parameter
    script    = local.reasoning
  }

  provisioner "local-exec" {
    command = "python3 ${self.input.script} apply ${self.input.name} ${local.wording} ${self.input.parameter}"
  }

  provisioner "local-exec" {
    when    = destroy
    command = "python3 ${self.input.script} delete ${self.input.name} ${self.input.parameter}"
  }

  depends_on = [terraform_data.enable]
}
