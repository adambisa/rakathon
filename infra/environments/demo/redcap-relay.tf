# The laptop opens SSH remote forwarding over SSM to this existing private host.
# Terraform owns only the relay network attachment and ALB route, not the host/IRIS.
variable "redcap_relay_instance_id" {
  description = "Existing SSM-managed EC2 host for laptop reverse forwarding."
  type        = string
  default     = "i-0927102898ac8a8d3"
  validation {
    condition     = can(regex("^i-[a-f0-9]{8,17}$", var.redcap_relay_instance_id))
    error_message = "Provide the existing SSM-managed instance ID."
  }
}

data "aws_instance" "redcap_relay" {
  instance_id = var.redcap_relay_instance_id
}

resource "aws_security_group" "redcap_relay" {
  name_prefix = "${local.name_prefix}-redcap-relay-"
  vpc_id      = aws_vpc.main.id
  description = "Laptop REDCap reverse forwarding: ALB only, no public ingress."
}

resource "aws_network_interface_sg_attachment" "redcap_relay" {
  security_group_id    = aws_security_group.redcap_relay.id
  network_interface_id = data.aws_instance.redcap_relay.network_interface_id
}

resource "aws_vpc_security_group_ingress_rule" "redcap_relay" {
  security_group_id            = aws_security_group.redcap_relay.id
  referenced_security_group_id = aws_security_group.alb.id
  ip_protocol                  = "tcp"
  from_port                    = 18765
  to_port                      = 18765
}

resource "aws_vpc_security_group_egress_rule" "alb_redcap_relay" {
  security_group_id            = aws_security_group.alb.id
  referenced_security_group_id = aws_security_group.redcap_relay.id
  ip_protocol                  = "tcp"
  from_port                    = 18765
  to_port                      = 18765
}

resource "aws_lb_target_group" "redcap_relay" {
  name                 = "${local.name_prefix}-redcap"
  target_type          = "ip"
  port                 = 18765
  protocol             = "HTTP"
  vpc_id               = aws_vpc.main.id
  deregistration_delay = 15
  health_check {
    path                = "/internal/redcap/healthz"
    matcher             = "200"
    interval            = 5
    timeout             = 3
    healthy_threshold   = 2
    unhealthy_threshold = 2
  }
}

resource "aws_lb_target_group_attachment" "redcap_relay" {
  target_group_arn = aws_lb_target_group.redcap_relay.arn
  target_id        = data.aws_instance.redcap_relay.private_ip
  port             = 18765
  depends_on       = [aws_network_interface_sg_attachment.redcap_relay, aws_vpc_security_group_ingress_rule.redcap_relay, aws_vpc_security_group_egress_rule.alb_redcap_relay]
}

resource "aws_lb_listener_rule" "redcap_relay" {
  listener_arn = aws_lb_listener.https.arn
  priority     = 10
  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.redcap_relay.arn
  }
  condition {
    path_pattern {
      values = ["/internal/redcap/*"]
    }
  }
}

output "redcap_relay" {
  description = "Non-secret laptop tunnel configuration and relay endpoint."
  value = {
    instance_id  = data.aws_instance.redcap_relay.id
    bind_address = data.aws_instance.redcap_relay.private_ip
    remote_port  = 18765
    url          = "https://${var.site_hostname}/internal/redcap/api/"
  }
}
