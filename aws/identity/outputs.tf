output "issuers" {
  description = "Each audience's token issuer: the api's STAFF_, CUSTOMER_ and ENGINEERING_TOKEN_ISSUER"
  value       = { for name, pool in aws_cognito_user_pool.audience : name => "https://${pool.endpoint}" }
}

output "client_ids" {
  description = "Each audience's web client ID: the api's token audience and the web app's VITE_COGNITO_CLIENT_ID"
  value       = { for name, client in aws_cognito_user_pool_client.web : name => client.id }
}

output "test_accounts_secret" {
  description = "Where the test accounts' passwords are kept"
  value       = aws_secretsmanager_secret.test_accounts.name
}
