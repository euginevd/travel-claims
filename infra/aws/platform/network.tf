# The workload network a landing zone hands each account (decision 36): private subnets in two
# availability zones, AWS's services reached through VPC endpoints, and one way out to the internet
# through a NAT gateway, standing in for the platform's central, inspected egress. The workload finds
# it through the /platform/network/* parameters, the contract a real platform publishes the same way.
# NETWORK_MODE=public builds none of it.

locals {
  private = var.network == "private"
  # Two zones that AgentCore's VPC mode supports, by ID, so the set never changes underneath.
  zones = var.zone_ids
  # What the workload calls: images and logs for the agent's runtime, settings, Bedrock (models,
  # guardrail, knowledge base) and AgentCore (runtime, memory, identity, gateways).
  interface_endpoints = toset([
    "ecr.api", "ecr.dkr", "logs", "ssm",
    "bedrock-runtime", "bedrock-agent-runtime", "bedrock-agentcore", "bedrock-agentcore.gateway",
  ])
}

# trivy:ignore:AWS-0178 flow logs are the platform's, into its log-archive account; this stands in for the network only
resource "aws_vpc" "workload" {
  #checkov:skip=CKV2_AWS_11: flow logs are the platform's, into its log-archive account; this stands in for the network only
  count = local.private ? 1 : 0

  cidr_block           = "10.40.0.0/16"
  enable_dns_support   = true
  enable_dns_hostnames = true
  tags                 = { Name = "${local.prefix}-workload" }
}

# Nothing may use the default security group.
resource "aws_default_security_group" "workload" {
  count  = local.private ? 1 : 0
  vpc_id = aws_vpc.workload[0].id
}

resource "aws_subnet" "private" {
  count = local.private ? length(local.zones) : 0

  vpc_id               = aws_vpc.workload[0].id
  availability_zone_id = local.zones[count.index]
  cidr_block           = cidrsubnet("10.40.0.0/16", 4, count.index)
  tags                 = { Name = "${local.prefix}-private-${local.zones[count.index]}" }
}

# The way out: one NAT gateway in a small public subnet, for what has no endpoint (Lambda function
# URLs, Cognito's signing keys, DSQL, the Anthropic API). A platform would inspect this centrally.
resource "aws_subnet" "egress" {
  count = local.private ? 1 : 0

  vpc_id               = aws_vpc.workload[0].id
  availability_zone_id = local.zones[0]
  cidr_block           = cidrsubnet("10.40.0.0/16", 8, 255)
  tags                 = { Name = "${local.prefix}-egress" }
}

resource "aws_internet_gateway" "workload" {
  count  = local.private ? 1 : 0
  vpc_id = aws_vpc.workload[0].id
}

resource "aws_eip" "nat" {
  count  = local.private ? 1 : 0
  domain = "vpc"
}

resource "aws_nat_gateway" "egress" {
  count = local.private ? 1 : 0

  allocation_id = aws_eip.nat[0].id
  subnet_id     = aws_subnet.egress[0].id
  depends_on    = [aws_internet_gateway.workload]
}

resource "aws_route_table" "egress" {
  count  = local.private ? 1 : 0
  vpc_id = aws_vpc.workload[0].id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.workload[0].id
  }
}

resource "aws_route_table_association" "egress" {
  count          = local.private ? 1 : 0
  subnet_id      = aws_subnet.egress[0].id
  route_table_id = aws_route_table.egress[0].id
}

resource "aws_route_table" "private" {
  count  = local.private ? 1 : 0
  vpc_id = aws_vpc.workload[0].id

  route {
    cidr_block     = "0.0.0.0/0"
    nat_gateway_id = aws_nat_gateway.egress[0].id
  }
}

resource "aws_route_table_association" "private" {
  count          = local.private ? length(local.zones) : 0
  subnet_id      = aws_subnet.private[count.index].id
  route_table_id = aws_route_table.private[0].id
}

# S3 and DynamoDB through free gateway endpoints: receipts, the knowledge files, the agent's image
# layers, checkpoints and the Copilot's chats never leave AWS's network.
resource "aws_vpc_endpoint" "gateway" {
  for_each = local.private ? toset(["s3", "dynamodb"]) : toset([])

  vpc_id            = aws_vpc.workload[0].id
  service_name      = "com.amazonaws.${var.region}.${each.key}"
  vpc_endpoint_type = "Gateway"
  route_table_ids   = [aws_route_table.private[0].id]
  tags              = { Name = "${local.prefix}-${each.key}" }
}

# The interface endpoints answer HTTPS from inside the network only.
resource "aws_security_group" "endpoints" {
  count = local.private ? 1 : 0

  name        = "${local.prefix}-endpoints"
  description = "HTTPS to AWS services from the workload network"
  vpc_id      = aws_vpc.workload[0].id

  ingress {
    description = "HTTPS from the workload network"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = [aws_vpc.workload[0].cidr_block]
  }
}

resource "aws_vpc_endpoint" "interface" {
  for_each = local.private ? local.interface_endpoints : toset([])

  vpc_id              = aws_vpc.workload[0].id
  service_name        = "com.amazonaws.${var.region}.${each.key}"
  vpc_endpoint_type   = "Interface"
  subnet_ids          = aws_subnet.private[*].id
  security_group_ids  = [aws_security_group.endpoints[0].id]
  private_dns_enabled = true
  tags                = { Name = "${local.prefix}-${each.key}" }
}

# The contract: what the workload reads, under the path a platform publishes to every account.
resource "aws_ssm_parameter" "vpc" {
  #checkov:skip=CKV2_AWS_34: an ID, not a secret
  count = local.private ? 1 : 0

  name  = "/platform/network/vpc-id"
  type  = "String"
  value = aws_vpc.workload[0].id
}

resource "aws_ssm_parameter" "subnets" {
  #checkov:skip=CKV2_AWS_34: IDs, not secrets
  count = local.private ? 1 : 0

  name  = "/platform/network/private-subnet-ids"
  type  = "StringList"
  value = join(",", aws_subnet.private[*].id)

  # Endpoints first, so nothing the workload runs here starts without them.
  depends_on = [aws_vpc_endpoint.interface, aws_vpc_endpoint.gateway, aws_route_table_association.private]
}
