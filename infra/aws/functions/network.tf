# Where this unit's code runs (decision 36). private: in the platform's private subnets, reaching AWS
# through its VPC endpoints and anything else through its egress, found by the /platform/network/*
# parameters it publishes. public: no VPC, to save the network's cost.
variable "network" {
  description = "private: the platform's private subnets; public: no VPC"
  type        = string
  default     = "private"
  validation {
    condition     = contains(["private", "public"], var.network)
    error_message = "network is private or public."
  }
}

data "aws_ssm_parameter" "vpc" {
  count = var.network == "private" ? 1 : 0
  name  = "/platform/network/vpc-id"
}

data "aws_ssm_parameter" "subnets" {
  count = var.network == "private" ? 1 : 0
  name  = "/platform/network/private-subnet-ids"
}

locals {
  private = var.network == "private"
  subnets = local.private ? split(",", data.aws_ssm_parameter.subnets[0].insecure_value) : []
}

# Nothing comes in; out, only HTTPS and DSQL's PostgreSQL port, through the endpoints or the egress.
# trivy:ignore:AWS-0104 out through the platform's egress, which an enterprise inspects centrally
resource "aws_security_group" "workload" {
  #checkov:skip=CKV2_AWS_5: attached to the functions through a dynamic block the check can't follow
  count = local.private ? 1 : 0

  name        = "${var.project}-${var.environment}-functions"
  description = "Outbound HTTPS and PostgreSQL for the ${var.project} functions"
  vpc_id      = data.aws_ssm_parameter.vpc[0].insecure_value

  egress {
    description = "HTTPS to AWS services and the app URLs"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    description = "PostgreSQL to Aurora DSQL"
    from_port   = 5432
    to_port     = 5432
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
}
