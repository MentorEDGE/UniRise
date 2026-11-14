resource "aws_db_subnet_group" "main" {
  name       = local.name
  subnet_ids = aws_subnet.private[*].id
}

# The master password is generated and stored by RDS in Secrets Manager; it never appears in Terraform code or state files.
resource "aws_db_instance" "main" {
  identifier     = local.name
  engine         = "postgres"
  engine_version = "16"
  instance_class = var.db_instance_class

  allocated_storage = var.db_allocated_storage
  storage_type      = "gp3"
  storage_encrypted = true

  db_name                     = "unirise"
  username                    = "unirise_admin"
  manage_master_user_password = true

  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [aws_security_group.db.id]
  publicly_accessible    = false
  multi_az               = false # dev only; production uses Multi-AZ

  backup_retention_period             = 7
  auto_minor_version_upgrade          = true
  iam_database_authentication_enabled = true
  copy_tags_to_snapshot               = true
  apply_immediately                   = true

  deletion_protection       = false # dev only; turn on for staging and production
  skip_final_snapshot       = false
  final_snapshot_identifier = "${local.name}-final"
}
