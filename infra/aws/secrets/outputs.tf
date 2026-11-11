output "app_secret_name" {
  description = "The SSM parameter the apps read their settings from at start (APP_SECRET)"
  value       = terraform_data.app.input
}
