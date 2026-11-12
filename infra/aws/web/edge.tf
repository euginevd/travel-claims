# The three apps on CloudFront's flat-rate Free plan (decision 30): WAF and DDoS protection at no cost.
locals {
  protected = var.free_plan ? toset(["portal", "dashboard", "console"]) : toset([])
  managed   = { AWSManagedRulesCommonRuleSet = 1, AWSManagedRulesKnownBadInputsRuleSet = 2, AWSManagedRulesAmazonIpReputationList = 3 }
}

# AWS's managed rules and a rate limit per IP; the plan includes them.
resource "aws_wafv2_web_acl" "app" {
  #checkov:skip=CKV_AWS_192: Log4j is in the known bad inputs rule set below
  #checkov:skip=CKV2_AWS_31: the Free plan has no WAF logs
  provider = aws.us_east_1
  for_each = local.protected

  name  = "${local.prefix}-${each.key}"
  scope = "CLOUDFRONT"

  default_action {
    allow {}
  }

  dynamic "rule" {
    for_each = local.managed
    content {
      name     = rule.key
      priority = rule.value

      override_action {
        none {}
      }

      statement {
        managed_rule_group_statement {
          name        = rule.key
          vendor_name = "AWS"

          # Receipts are up to 5 MB, past the common rules' 8 KB body limit; the api checks their size.
          dynamic "rule_action_override" {
            for_each = rule.key == "AWSManagedRulesCommonRuleSet" ? ["SizeRestrictions_BODY"] : []
            content {
              name = rule_action_override.value
              action_to_use {
                count {}
              }
            }
          }
        }
      }

      visibility_config {
        cloudwatch_metrics_enabled = true
        metric_name                = rule.key
        sampled_requests_enabled   = true
      }
    }
  }

  rule {
    name     = "rate-per-ip"
    priority = 4

    action {
      block {}
    }

    statement {
      rate_based_statement {
        limit              = 1000
        aggregate_key_type = "IP"
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "rate-per-ip"
      sampled_requests_enabled   = true
    }
  }

  visibility_config {
    cloudwatch_metrics_enabled = true
    metric_name                = "${local.prefix}-${each.key}"
    sampled_requests_enabled   = true
  }
}

# One Free plan per app: its distribution and its web ACL. The pipeline can't approve a paid tier.
resource "aws_pricingplanmanager_subscription" "free" {
  provider = aws.us_east_1
  for_each = local.protected

  plan_family   = "CloudFront"
  plan_tier     = "FREE"
  resource_arns = [aws_cloudfront_distribution.web[each.key].arn, aws_wafv2_web_acl.app[each.key].arn]
}
