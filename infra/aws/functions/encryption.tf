# Customer-managed encryption (decision 45), when ENCRYPTION_KEYS=platform: the functions' logs
# under the platform team's data key, and the roles may use it through S3, SSM, DSQL and DynamoDB, read from /platform/kms/data-key-arn. aws (the default): AWS-owned keys.
variable "encryption_keys" {
  description = "platform: the platform team's KMS data key; aws: AWS-managed or AWS-owned keys"
  type        = string
  default     = "aws"
  validation {
    condition     = contains(["aws", "platform"], var.encryption_keys)
    error_message = "encryption_keys is aws or platform."
  }
}

data "aws_ssm_parameter" "data_key" {
  count = var.encryption_keys == "platform" ? 1 : 0
  name  = "/platform/kms/data-key-arn"
}

locals {
  data_key = var.encryption_keys == "platform" ? data.aws_ssm_parameter.data_key[0].insecure_value : null
}

# Each role may use the platform's key only through the services that hold its data.
locals {
  key_grants = local.data_key == null ? [] : [{
    actions   = ["kms:Decrypt", "kms:GenerateDataKey"]
    resources = [local.data_key]
    condition = { StringLike = { "kms:ViaService" = ["s3.*.amazonaws.com", "ssm.*.amazonaws.com", "dsql.*.amazonaws.com", "dynamodb.*.amazonaws.com"] } }
  }]
}
