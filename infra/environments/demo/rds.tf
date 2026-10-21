resource "aws_db_subnet_group" "app" {
  name       = local.name_prefix
  subnet_ids = [for subnet in aws_subnet.private : subnet.id]
}

resource "aws_security_group" "database" {
  name_prefix = "${local.name_prefix}-db-"
  vpc_id      = aws_vpc.main.id
  description = "Private PostgreSQL from app and migration tasks only."
}

resource "aws_vpc_security_group_ingress_rule" "database" {
  for_each = {
    app             = aws_security_group.app.id
    document_ingest = aws_security_group.document_ingest.id
    case_mapping    = aws_security_group.case_mapping.id
  }
  security_group_id            = aws_security_group.database.id
  referenced_security_group_id = each.value
  ip_protocol                  = "tcp"
  from_port                    = 5432
  to_port                      = 5432
}

resource "aws_db_parameter_group" "app" {
  name_prefix = "${local.name_prefix}-pg18-"
  family      = "postgres18"
  parameter {
    name         = "rds.force_ssl"
    value        = "1"
    apply_method = "pending-reboot"
  }
  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_db_instance" "app" {
  identifier                      = local.name_prefix
  engine                          = "postgres"
  engine_version                  = "18.6"
  instance_class                  = "db.t4g.micro"
  db_name                         = "prostapaper"
  username                        = "prostapaper_admin"
  manage_master_user_password     = true
  allocated_storage               = 20
  max_allocated_storage           = 100
  storage_type                    = "gp3"
  storage_encrypted               = true
  multi_az                        = false
  availability_zone               = "eu-central-1a"
  publicly_accessible             = false
  db_subnet_group_name            = aws_db_subnet_group.app.name
  vpc_security_group_ids          = [aws_security_group.database.id]
  parameter_group_name            = aws_db_parameter_group.app.name
  backup_retention_period         = 1
  backup_window                   = "02:00-03:00"
  maintenance_window              = "sun:03:30-sun:04:30"
  auto_minor_version_upgrade      = true
  allow_major_version_upgrade     = false
  apply_immediately               = false
  deletion_protection             = true
  skip_final_snapshot             = false
  final_snapshot_identifier       = "${local.name_prefix}-final"
  copy_tags_to_snapshot           = true
  enabled_cloudwatch_logs_exports = ["postgresql"]
}

resource "aws_cloudwatch_log_group" "database" {
  name              = "/aws/rds/instance/${local.name_prefix}/postgresql"
  retention_in_days = 7
}

locals {
  database_environment = [
    { name = "PGHOST", value = aws_db_instance.app.address },
    { name = "PGPORT", value = tostring(aws_db_instance.app.port) },
    { name = "PGDATABASE", value = aws_db_instance.app.db_name },
    { name = "PGSSLMODE", value = "verify-full" },
    { name = "NODE_EXTRA_CA_CERTS", value = local.database_ca_file },
  ]
  database_ca_file = "/etc/prostapaper/certs/rds-eu-central-1.pem"
}

output "database_endpoint" {
  value = aws_db_instance.app.address
}

output "database_master_secret_arn" {
  value = aws_db_instance.app.master_user_secret[0].secret_arn
}

resource "aws_cloudwatch_metric_alarm" "database" {
  for_each = {
    storage = {
      metric     = "FreeStorageSpace"
      threshold  = 2147483648
      comparison = "LessThanThreshold"
    }
    memory = {
      metric     = "FreeableMemory"
      threshold  = 134217728
      comparison = "LessThanThreshold"
    }
    connections = {
      metric     = "DatabaseConnections"
      threshold  = 40
      comparison = "GreaterThanThreshold"
    }
  }
  alarm_name          = "${local.name_prefix}-db-${each.key}"
  alarm_description   = "Inspect the demo DB capacity; notification destination is not configured."
  namespace           = "AWS/RDS"
  metric_name         = each.value.metric
  statistic           = "Average"
  period              = 300
  evaluation_periods  = 3
  threshold           = each.value.threshold
  comparison_operator = each.value.comparison
  treat_missing_data  = "missing"
  actions_enabled     = false
  dimensions          = { DBInstanceIdentifier = aws_db_instance.app.identifier }
}
