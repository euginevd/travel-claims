output "app_secret_name" {
  description = "Where the apps read their secrets at start (APP_SECRET)"
  value       = aws_secretsmanager_secret.app.name
}
