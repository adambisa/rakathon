# Adopt the relay bootstrap on merge. Older main deployments cannot own/destroy it.
# Keep the live bootstrap outside shared state until this configuration is deployed.

import {
  to = aws_lb_listener_rule.redcap_relay
  id = "arn:aws:elasticloadbalancing:eu-central-1:000000000000:listener-rule/app/prostapaper-demo/1136e10b1f908f5a/e6e9d025cc68a754/d6581f7363e4660f"
}

import {
  to = aws_lb_target_group.redcap_relay
  id = "arn:aws:elasticloadbalancing:eu-central-1:000000000000:targetgroup/prostapaper-demo-redcap/99c5cd502a93e0f7"
}

import {
  to = aws_lb_target_group_attachment.redcap_relay
  id = "arn:aws:elasticloadbalancing:eu-central-1:000000000000:targetgroup/prostapaper-demo-redcap/99c5cd502a93e0f7,10.0.0.0,18765"
}

import {
  to = aws_network_interface_sg_attachment.redcap_relay
  id = "eni-07695f9623ccac493_sg-027da8084fff1bef3"
}

import {
  to = aws_security_group.redcap_relay
  id = "sg-027da8084fff1bef3"
}

import {
  to = aws_vpc_security_group_egress_rule.alb_redcap_relay
  id = "sgr-00a874139ae5a275b"
}

import {
  to = aws_vpc_security_group_ingress_rule.redcap_relay
  id = "sgr-07325c12332283538"
}
