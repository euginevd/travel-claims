# The company's own domain on every site (decision 45), when DOMAIN_NAME is set: the project page at
# the domain, and portal., dashboard. and console. under it, each with an ACM certificate (in
# us-east-1, as CloudFront needs) validated through the domain's Route 53 zone, which the platform
# team delegates. Empty (the default): CloudFront's own *.cloudfront.net addresses.
variable "domain_name" {
  description = "The domain the sites are served under, such as claims.example.com.au; empty for CloudFront's own addresses"
  type        = string
  default     = ""
}

locals {
  custom_domain = var.domain_name != ""
  # The project page at the domain itself; each app under its own name.
  site_names = { for name, _ in local.apps : name => (name == "home" ? var.domain_name : "${name}.${var.domain_name}") }
}

data "aws_route53_zone" "domain" {
  count = local.custom_domain ? 1 : 0
  name  = var.domain_name
}

resource "aws_acm_certificate" "sites" {
  provider = aws.us_east_1
  count    = local.custom_domain ? 1 : 0

  domain_name               = var.domain_name
  subject_alternative_names = [for name, site in local.site_names : site if name != "home"]
  validation_method         = "DNS"

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_route53_record" "validation" {
  for_each = local.custom_domain ? {
    for option in aws_acm_certificate.sites[0].domain_validation_options : option.domain_name => option
  } : {}

  zone_id         = data.aws_route53_zone.domain[0].zone_id
  name            = each.value.resource_record_name
  type            = each.value.resource_record_type
  records         = [each.value.resource_record_value]
  ttl             = 300
  allow_overwrite = true
}

resource "aws_acm_certificate_validation" "sites" {
  provider = aws.us_east_1
  count    = local.custom_domain ? 1 : 0

  certificate_arn         = aws_acm_certificate.sites[0].arn
  validation_record_fqdns = [for record in aws_route53_record.validation : record.fqdn]
}

# Each site's name points at its distribution, over IPv4 and IPv6.
resource "aws_route53_record" "site" {
  for_each = local.custom_domain ? {
    for pair in setproduct(keys(local.apps), ["A", "AAAA"]) : "${pair[0]}-${pair[1]}" => { app = pair[0], type = pair[1] }
  } : {}

  zone_id = data.aws_route53_zone.domain[0].zone_id
  name    = local.site_names[each.value.app]
  type    = each.value.type

  alias {
    name                   = aws_cloudfront_distribution.web[each.value.app].domain_name
    zone_id                = aws_cloudfront_distribution.web[each.value.app].hosted_zone_id
    evaluate_target_health = false
  }
}
