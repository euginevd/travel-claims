output "cluster_endpoint" {
  description = "The DSQL cluster's endpoint; sign in as admin with an IAM token"
  value       = "${aws_dsql_cluster.records.identifier}.dsql.${var.region}.on.aws"
}

output "checkpoint_table" {
  description = "The agent's checkpoint table (CHECKPOINT_TABLE)"
  value       = aws_dynamodb_table.checkpoints.name
}
