# No NAT gateway on purpose: it costs about as much as the rest of dev. Databases sit in private subnets with no route
# to the internet; the optional bastion sits in a public subnet with no inbound rules and is reached through SSM.
resource "aws_vpc" "main" {
  cidr_block           = var.vpc_cidr
  enable_dns_support   = true
  enable_dns_hostnames = true
  tags                 = { Name = local.name }
}

resource "aws_internet_gateway" "main" {
  vpc_id = aws_vpc.main.id
  tags   = { Name = local.name }
}

resource "aws_subnet" "public" {
  count                   = 2
  vpc_id                  = aws_vpc.main.id
  availability_zone       = local.azs[count.index]
  cidr_block              = cidrsubnet(var.vpc_cidr, 8, count.index)
  map_public_ip_on_launch = false
  tags                    = { Name = "${local.name}-public-${count.index + 1}" }
}

resource "aws_subnet" "private" {
  count             = 2
  vpc_id            = aws_vpc.main.id
  availability_zone = local.azs[count.index]
  cidr_block        = cidrsubnet(var.vpc_cidr, 8, count.index + 10)
  tags              = { Name = "${local.name}-private-${count.index + 1}" }
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id
  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.main.id
  }
  tags = { Name = "${local.name}-public" }
}

resource "aws_route_table_association" "public" {
  count          = 2
  subnet_id      = aws_subnet.public[count.index].id
  route_table_id = aws_route_table.public.id
}

resource "aws_route_table" "private" {
  vpc_id = aws_vpc.main.id
  tags   = { Name = "${local.name}-private" }
}

resource "aws_route_table_association" "private" {
  count          = 2
  subnet_id      = aws_subnet.private[count.index].id
  route_table_id = aws_route_table.private.id
}

# Free gateway endpoint so private resources can reach S3 without a NAT.
resource "aws_vpc_endpoint" "s3" {
  vpc_id            = aws_vpc.main.id
  service_name      = "com.amazonaws.${var.region}.s3"
  vpc_endpoint_type = "Gateway"
  route_table_ids   = [aws_route_table.private.id, aws_route_table.public.id]
  tags              = { Name = "${local.name}-s3" }
}

resource "aws_security_group" "bastion" {
  name        = "${local.name}-bastion"
  description = "No inbound. Reached through SSM Session Manager only. Egress: PostgreSQL to the database and HTTPS only."
  vpc_id      = aws_vpc.main.id
}

resource "aws_security_group" "db" {
  name        = "${local.name}-db"
  description = "PostgreSQL from the bastion (and later the app service)."
  vpc_id      = aws_vpc.main.id
}

resource "aws_vpc_security_group_ingress_rule" "db_from_bastion" {
  security_group_id            = aws_security_group.db.id
  referenced_security_group_id = aws_security_group.bastion.id
  from_port                    = 5432
  to_port                      = 5432
  ip_protocol                  = "tcp"
  description                  = "bastion"
}

# Egress is limited so the tunnel cannot be used to reach anything but the database: PostgreSQL to the DB security group, plus
# HTTPS for the SSM agent and package repositories (there are no VPC endpoints for SSM, to avoid their hourly cost).
resource "aws_vpc_security_group_egress_rule" "bastion_to_db" {
  security_group_id            = aws_security_group.bastion.id
  referenced_security_group_id = aws_security_group.db.id
  from_port                    = 5432
  to_port                      = 5432
  ip_protocol                  = "tcp"
  description                  = "PostgreSQL to the database"
}

resource "aws_vpc_security_group_egress_rule" "bastion_https" {
  security_group_id = aws_security_group.bastion.id
  cidr_ipv4         = "0.0.0.0/0"
  from_port         = 443
  to_port           = 443
  ip_protocol       = "tcp"
  description       = "HTTPS for the SSM agent"
}
