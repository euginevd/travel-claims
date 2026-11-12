# Customer-managed encryption (decision 45), when ENCRYPTION_KEYS=platform: the apps' settings
# parameter under the platform team's data key, read from /platform/kms/data-key-arn. aws (the default): SSM's own key.
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
