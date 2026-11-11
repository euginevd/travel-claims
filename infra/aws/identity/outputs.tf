output "issuers" {
  description = "Each audience's token issuer: the api's STAFF_, CUSTOMER_ and ENGINEERING_TOKEN_ISSUER"
  value       = { for name, pool in aws_cognito_user_pool.audience : name => "https://${pool.endpoint}" }
}

output "client_ids" {
  description = "Each audience's web client ID: the api's token audience and the web app's VITE_COGNITO_CLIENT_ID"
  value       = { for name, client in aws_cognito_user_pool_client.web : name => client.id }
}


output "staff_sso_domains" {
  description = "The hosted sign-in domain of each pool with company sign-in: the web app's VITE_STAFF_SSO_DOMAIN"
  value       = { for name, domain in aws_cognito_user_pool_domain.sso : name => "${domain.domain}.auth.${var.region}.amazoncognito.com" }
}
