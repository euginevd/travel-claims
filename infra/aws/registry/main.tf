# One repository per image the pipeline builds; Lambda and AgentCore Runtime pull from them.
locals {
  apps = toset(["api", "context", "copilot", "agent"])
}

resource "aws_ecr_repository" "app" {
  #checkov:skip=CKV_AWS_136: AWS-managed encryption is enough for app images; a customer key adds a key policy to run
  for_each = local.apps

  name                 = "${var.project}/${each.key}"
  image_tag_mutability = "IMMUTABLE"
  # Torn down with its images.
  force_delete = true

  image_scanning_configuration {
    scan_on_push = true
  }

  encryption_configuration {
    encryption_type = "AES256"
  }
}

# Keeps the last 10 images per app, so storage stays near nothing.
resource "aws_ecr_lifecycle_policy" "app" {
  for_each = aws_ecr_repository.app

  repository = each.value.name
  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Keep the last 2 images: the running one and one to roll back to"
      selection    = { tagStatus = "any", countType = "imageCountMoreThan", countNumber = 2 }
      action       = { type = "expire" }
    }]
  })
}
