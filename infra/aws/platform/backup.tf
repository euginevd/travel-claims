# AWS Backup for the workload's data (decision 38), as a platform's organization backup policy runs
# it: a vault, a daily plan, and a selection by tag, so any resource tagged Backup=daily is covered
# without the platform knowing its name. Here the workload's DSQL cluster carries the tag. No Vault
# Lock in dev, so tear down can empty the vault; a platform locks it and copies to another account.
resource "aws_backup_vault" "workload" {
  #checkov:skip=CKV_AWS_166: AWS Backup's own key in this reference; a platform uses its customer-managed key
  name          = "${local.prefix}-backups"
  force_destroy = true
}

resource "aws_backup_plan" "daily" {
  name = "${local.prefix}-daily"

  rule {
    rule_name         = "daily"
    target_vault_name = aws_backup_vault.workload.name
    schedule          = "cron(0 15 * * ? *)" # 1 am in Sydney
    lifecycle {
      delete_after = 7
    }
  }
}

resource "aws_iam_role" "backup" {
  name                 = "${local.prefix}-backup"
  description          = "Lets AWS Backup back up and restore the ${var.project} resources tagged Backup=daily"
  permissions_boundary = "arn:${data.aws_partition.current.partition}:iam::${data.aws_caller_identity.current.account_id}:policy/${var.project}-boundary"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "backup.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "backup" {
  for_each = toset(["AWSBackupServiceRolePolicyForBackup", "AWSBackupServiceRolePolicyForRestores"])

  role       = aws_iam_role.backup.name
  policy_arn = "arn:${data.aws_partition.current.partition}:iam::aws:policy/service-role/${each.key}"
}

resource "aws_backup_selection" "tagged" {
  name         = "${local.prefix}-tagged"
  plan_id      = aws_backup_plan.daily.id
  iam_role_arn = aws_iam_role.backup.arn
  resources    = ["*"]

  condition {
    string_equals {
      key   = "aws:ResourceTag/Backup"
      value = "daily"
    }
  }
}
