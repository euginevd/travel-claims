# One secret per environment (spec 37), created empty: its value is set by hand, so no secret is in
# Terraform variables or state. Its value is JSON: DATABASE_URL, CHECKPOINT_DATABASE_URL and
# UNDERCOVER_API_KEY, plus AGENT_RUNTIME_ARN once the agent unit has applied.
resource "aws_secretsmanager_secret" "app" {
  #checkov:skip=CKV_AWS_149: the AWS-managed key is enough for a demo; real data would take a customer key
  #checkov:skip=CKV2_AWS_57: the values come from Supabase and are rotated there by hand
  name        = "${var.project}/${var.environment}/app"
  description = "The ${var.project} apps' database URLs and the agent's key, as JSON; set by hand"
  # dev can be torn down and recreated at once; prod keeps a week to undo a deletion.
  recovery_window_in_days = var.environment == "prod" ? 7 : 0
}
