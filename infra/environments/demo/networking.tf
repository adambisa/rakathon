locals {
  name_prefix = "prostapaper-demo"
}

resource "aws_vpc" "main" {
  cidr_block           = "10.42.0.0/16"
  enable_dns_support   = true
  enable_dns_hostnames = true

  tags = { Name = local.name_prefix }
}

resource "aws_subnet" "public" {
  vpc_id                  = aws_vpc.main.id
  cidr_block              = "10.42.1.0/24"
  availability_zone       = "eu-central-1a"
  map_public_ip_on_launch = false

  tags = { Name = "${local.name_prefix}-public-a" }
}

resource "aws_subnet" "private" {
  for_each = {
    a = { cidr = "10.42.2.0/24", az = "eu-central-1a" }
    b = { cidr = "10.42.3.0/24", az = "eu-central-1b" }
  }

  vpc_id                  = aws_vpc.main.id
  cidr_block              = each.value.cidr
  availability_zone       = each.value.az
  map_public_ip_on_launch = false

  tags = { Name = "${local.name_prefix}-private-${each.key}" }
}

resource "aws_internet_gateway" "main" {
  vpc_id = aws_vpc.main.id

  tags = { Name = local.name_prefix }
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id

  tags = { Name = "${local.name_prefix}-public" }
}

resource "aws_route" "internet" {
  route_table_id         = aws_route_table.public.id
  destination_cidr_block = "0.0.0.0/0"
  gateway_id             = aws_internet_gateway.main.id
}

resource "aws_route_table_association" "public" {
  subnet_id      = aws_subnet.public.id
  route_table_id = aws_route_table.public.id
}

resource "aws_route_table" "private" {
  vpc_id = aws_vpc.main.id

  tags = { Name = "${local.name_prefix}-private" }
}

resource "aws_route_table_association" "private" {
  for_each = aws_subnet.private

  subnet_id      = each.value.id
  route_table_id = aws_route_table.private.id
}

# S3 stays on the gateway endpoint so document traffic never pays for NAT.
resource "aws_vpc_endpoint" "s3" {
  vpc_id            = aws_vpc.main.id
  service_name      = "com.amazonaws.eu-central-1.s3"
  vpc_endpoint_type = "Gateway"
  route_table_ids   = [aws_route_table.private.id]

  tags = { Name = "${local.name_prefix}-s3" }
}

# The case-mapping function needs api.openai.com from a private subnet; nothing else routes through here.
resource "aws_eip" "nat" {
  domain = "vpc"

  tags = { Name = "${local.name_prefix}-nat" }
}

resource "aws_nat_gateway" "main" {
  allocation_id = aws_eip.nat.id
  subnet_id     = aws_subnet.public.id

  tags = { Name = local.name_prefix }

  depends_on = [aws_internet_gateway.main]
}

resource "aws_route" "private_internet" {
  route_table_id         = aws_route_table.private.id
  destination_cidr_block = "0.0.0.0/0"
  nat_gateway_id         = aws_nat_gateway.main.id
}

resource "aws_security_group" "bedrock_mantle" {
  name_prefix = "${local.name_prefix}-bedrock-mantle-"
  vpc_id      = aws_vpc.main.id
  description = "Bedrock Mantle interface endpoint: HTTPS from the document-ingest function only."
}

resource "aws_vpc_security_group_ingress_rule" "bedrock_mantle" {
  security_group_id            = aws_security_group.bedrock_mantle.id
  referenced_security_group_id = aws_security_group.document_ingest.id
  ip_protocol                  = "tcp"
  from_port                    = 443
  to_port                      = 443
}

resource "aws_vpc_endpoint" "bedrock_mantle" {
  vpc_id              = aws_vpc.main.id
  service_name        = "com.amazonaws.eu-central-1.bedrock-mantle"
  vpc_endpoint_type   = "Interface"
  subnet_ids          = [for subnet in aws_subnet.private : subnet.id]
  security_group_ids  = [aws_security_group.bedrock_mantle.id]
  private_dns_enabled = true

  tags = { Name = "${local.name_prefix}-bedrock-mantle" }
}

# ALB requires two public subnets in separate availability zones.
resource "aws_subnet" "public_b" {
  vpc_id                  = aws_vpc.main.id
  cidr_block              = "10.42.4.0/24"
  availability_zone       = "eu-central-1b"
  map_public_ip_on_launch = false
  tags                    = { Name = "${local.name_prefix}-public-b" }
}

resource "aws_route_table_association" "public_b" {
  subnet_id      = aws_subnet.public_b.id
  route_table_id = aws_route_table.public.id
}
