# One JSON secret per environment (spec 37), created empty and filled by hand, so no value is in state.
resource "aws_secretsmanager_secret" "app" {
  #checkov:skip=CKV_AWS_149: the AWS-managed key is enough for a demo; real data would take a customer key
  #checkov:skip=CKV2_AWS_57: the values come from Supabase and are rotated there by hand
  name        = "${var.project}/${var.environment}/app"
  description = "The ${var.project} apps' database URLs and the agent's key, as JSON; set by hand"
  # dev can be torn down and recreated at once; prod keeps a week to undo a deletion.
  recovery_window_in_days = var.environment == "prod" ? 7 : 0
}
