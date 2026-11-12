output "alerts_topic" {
  description = "The SNS topic alarms publish to"
  value       = aws_sns_topic.alerts.arn
}
