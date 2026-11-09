output "guardrail" {
  description = "The guardrail's ID and version"
  value       = { id = aws_bedrock_guardrail.claims.guardrail_id, version = aws_bedrock_guardrail_version.claims.version }
}
