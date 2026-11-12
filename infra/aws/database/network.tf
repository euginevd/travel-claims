# DSQL through its own endpoint in the platform's private subnets (decision 38), so the api's
# connections never leave the network. The endpoint's hostname differs from the public one:
# <cluster>.<service id>.<region>.on.aws, with private DNS on. NETWORK_MODE=public uses the public one.
variable "network" {
  description = "private: DSQL through an endpoint in the platform's private subnets; public: its public endpoint"
  type        = string
  default     = "public"
  validation {
    condition     = contains(["private", "public"], var.network)
    error_message = "network is private or public."
  }
}

data "aws_ssm_parameter" "vpc" {
  count = local.private ? 1 : 0
  name  = "/platform/network/vpc-id"
}

data "aws_ssm_parameter" "subnets" {
  count = local.private ? 1 : 0
  name  = "/platform/network/private-subnet-ids"
}

data "aws_vpc" "platform" {
  count = local.private ? 1 : 0
  id    = data.aws_ssm_parameter.vpc[0].insecure_value
}

locals {
  private = var.network == "private"
  # com.amazonaws.<region>.dsql-xxxx: the last part names the cluster's endpoint service.
  dsql_service = element(split(".", aws_dsql_cluster.records.vpc_endpoint_service_name), 3)
  dsql_host = (local.private
    ? "${aws_dsql_cluster.records.identifier}.${local.dsql_service}.${var.region}.on.aws"
  : "${aws_dsql_cluster.records.identifier}.dsql.${var.region}.on.aws")
}

# Only PostgreSQL, only from inside the network.
resource "aws_security_group" "dsql" {
  count = local.private ? 1 : 0

  name        = "${local.prefix}-dsql"
  description = "PostgreSQL to Aurora DSQL from the workload network"
  vpc_id      = data.aws_vpc.platform[0].id

  ingress {
    description = "PostgreSQL from the workload network"
    from_port   = 5432
    to_port     = 5432
    protocol    = "tcp"
    cidr_blocks = [data.aws_vpc.platform[0].cidr_block]
  }
}

resource "aws_vpc_endpoint" "dsql" {
  count = local.private ? 1 : 0

  vpc_id              = data.aws_vpc.platform[0].id
  service_name        = aws_dsql_cluster.records.vpc_endpoint_service_name
  vpc_endpoint_type   = "Interface"
  subnet_ids          = split(",", data.aws_ssm_parameter.subnets[0].insecure_value)
  security_group_ids  = [aws_security_group.dsql[0].id]
  private_dns_enabled = true
  tags                = { Name = "${local.prefix}-dsql" }
}
