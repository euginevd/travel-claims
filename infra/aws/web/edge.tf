# CloudFront WAF (decision 47): `off`, the prototype's cost-optimized default, or `on`, the enterprise
# pattern, where the platform team's AWS Firewall Manager applies its centrally managed WAF policy
# (AWS managed rule groups and rate limits it owns) to every distribution in the policy's scope.
# The workload never builds or edits that web ACL: it tags its distributions into scope and leaves
# the association to Firewall Manager, so the platform can change the rules for every workload at once.
locals {
  waf = var.cloudfront_waf == "on"
  # The contract with the platform: its Firewall Manager CloudFront policy scopes in this tag.
  firewall_manager_tags = local.waf ? { FirewallManager = "cloudfront-waf" } : {}
}

# With the WAF on, the plan fails clearly unless the platform publishes its Firewall Manager policy,
# the same way the network and keys are found (decision 41).
data "aws_ssm_parameter" "waf_policy" {
  count = local.waf ? 1 : 0
  name  = "/platform/waf/cloudfront-policy-id"
}
