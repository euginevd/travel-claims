output "repository_urls" {
  description = "Where the pipeline pushes each app's image"
  value       = { for app, repo in aws_ecr_repository.app : app => repo.repository_url }
}
