output "agent_runtime_arn" {
  description = "AGENT_RUNTIME_ARN: added to the app settings' JSON so the api reaches the agent here"
  value       = aws_bedrockagentcore_agent_runtime.agent.agent_runtime_arn
}
