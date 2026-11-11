output "guardrail" {
  description = "The input guardrail's ID and version"
  value       = { id = aws_bedrock_guardrail.claims.guardrail_id, version = aws_bedrock_guardrail_version.claims.version }
}

output "answer_guardrail" {
  description = "The answers' grounding guardrail's ID and version"
  value       = { id = aws_bedrock_guardrail.answers.guardrail_id, version = aws_bedrock_guardrail_version.answers.version }
}

output "letter_guardrail" {
  description = "The letters' sensitive-numbers guardrail's ID and version"
  value       = { id = aws_bedrock_guardrail.letters.guardrail_id, version = aws_bedrock_guardrail_version.letters.version }
}
