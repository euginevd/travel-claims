# The records in Aurora DSQL and the agent's checkpoints in DynamoDB (decision 30); serverless, with DSQL
# reached through its own endpoint on the private network (network.tf).
locals {
  prefix = "${var.project}-${var.environment}"
}

# Serverless PostgreSQL with IAM sign-in, so no password exists; the platform's key with
# ENCRYPTION_KEYS=platform (encryption.tf), an AWS-owned key otherwise.
resource "aws_dsql_cluster" "records" {
  kms_encryption_key = local.data_key

  # Backup=daily: the platform's backup plan selects it by this tag (decision 38).
  tags = { Name = "${local.prefix}-records", Backup = "daily" }
}

# The agent's checkpoints (LangGraph DynamoDBSaver's schema), compressed and expired after a week.
resource "aws_dynamodb_table" "checkpoints" {
  #checkov:skip=CKV_AWS_119: an AWS-owned key is enough for made-up data; a customer key is a setting (decision 45)
  #checkov:skip=CKV_AWS_28: point-in-time recovery costs and the data is made up; on before real data
  name         = "${local.prefix}-checkpoints"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "PK"
  range_key    = "SK"

  attribute {
    name = "PK"
    type = "S"
  }

  attribute {
    name = "SK"
    type = "S"
  }

  ttl {
    attribute_name = "ttl"
    enabled        = true
  }


  server_side_encryption {
    enabled     = true
    kms_key_arn = local.data_key
  }

  # Backup=daily: the platform's backup policy selects it by this tag (decision 45).
  tags = { Backup = "daily" }
}

# The Copilot's conversations and each handler's notes, found by handler through by_handler.
resource "aws_dynamodb_table" "copilot" {
  #checkov:skip=CKV_AWS_119: an AWS-owned key is enough for made-up data; a customer key is a setting (decision 45)
  #checkov:skip=CKV_AWS_28: point-in-time recovery costs and the data is made up; on before real data
  name         = "${local.prefix}-copilot"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "PK"
  range_key    = "SK"

  attribute {
    name = "PK"
    type = "S"
  }

  attribute {
    name = "SK"
    type = "S"
  }

  attribute {
    name = "handler_id"
    type = "S"
  }

  attribute {
    name = "created_at"
    type = "S"
  }

  global_secondary_index {
    name            = "by_handler"
    projection_type = "ALL"

    key_schema {
      attribute_name = "handler_id"
      key_type       = "HASH"
    }

    key_schema {
      attribute_name = "created_at"
      key_type       = "RANGE"
    }
  }


  server_side_encryption {
    enabled     = true
    kms_key_arn = local.data_key
  }

  # Backup=daily: the platform's backup policy selects it by this tag (decision 45).
  tags = { Backup = "daily" }
}

# Tells the apps where they are, through the settings parameter they read at start.
resource "terraform_data" "settings" {
  triggers_replace = [local.dsql_host, aws_dynamodb_table.checkpoints.name, aws_dynamodb_table.copilot.name]

  depends_on = [aws_vpc_endpoint.dsql]

  provisioner "local-exec" {
    # The endpoint first, so the api never gets a host that doesn't resolve yet.
    command = "python3 ${path.module}/../../../scripts/fill-secret.py /${var.project}/${var.environment}/app 'DATABASE_URL=postgresql+psycopg://admin@${local.dsql_host}:5432/postgres?sslmode=verify-full&sslrootcert=/etc/ssl/certs/ca-certificates.crt' CHECKPOINT_TABLE=${aws_dynamodb_table.checkpoints.name} COPILOT_TABLE=${aws_dynamodb_table.copilot.name}"
  }
}
