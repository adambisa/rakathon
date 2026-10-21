output "vpc_id" {
  value = aws_vpc.main.id
}

output "private_subnet_ids" {
  value = { for name, subnet in aws_subnet.private : name => subnet.id }
}

output "website_url" {
  description = "Public website address."
  value       = "https://${var.site_hostname}"
}
