# Each web app in a private bucket behind its own CloudFront distribution (spec 30), forwarding only its api prefixes.
data "aws_caller_identity" "current" {}
data "aws_region" "current" {}

locals {
  account = data.aws_caller_identity.current.account_id
  region  = data.aws_region.current.region
  prefix  = "${var.project}-${var.environment}"

  # Which function each app's api prefixes reach, as each nginx.conf forwards them locally.
  apps = {
    portal    = { "/api/customer/*" = "api" }
    dashboard = { "/api/staff/*" = "api", "/api/copilot/*" = "copilot" }
    console   = { "/api/engineering/*" = "api" }
    home      = { "/api/demo/*" = "api" }
  }

  # The apps reach only themselves and Cognito; the project page pings the three apps' sites.
  connect = {
    app  = "'self' https://cognito-idp.${local.region}.amazonaws.com"
    home = "'self' https://*.cloudfront.net"
  }

  # AWS's managed policies: cache static files, never cache the api, and send the origin its own host.
  caching_optimized   = "658327ea-f89d-4fab-a63d-7e88639e58f6"
  caching_disabled    = "4135ea2d-6df8-44a3-9df3-4b5a84be39ad"
  all_viewer_but_host = "b689b0a8-53d0-40ab-baf2-68738e2966ac"
}

data "aws_lambda_function_url" "origin" {
  for_each = toset(["api", "copilot"])

  function_name = "${local.prefix}-${each.key}"
}

resource "aws_s3_bucket" "web" {
  #checkov:skip=CKV_AWS_18: access logs need a second bucket; the files are the public build of the app
  #checkov:skip=CKV_AWS_144: CloudFront caches worldwide, so one region is enough for the build
  #checkov:skip=CKV_AWS_145: the bucket holds the app's public build, so S3-managed encryption is enough
  #checkov:skip=CKV2_AWS_62: nothing reacts to a new build; the workflow invalidates CloudFront itself
  #checkov:skip=CKV_AWS_21: each build replaces the last from git, so versions add nothing
  #checkov:skip=CKV2_AWS_61: the workflow replaces the whole build each time, so nothing ages out
  #checkov:skip=CKV2_AWS_6: the public access block is below; the check can't follow its for_each
  for_each = local.apps

  bucket        = "${var.project}-web-${var.environment}-${each.key}-${local.account}"
  force_destroy = true
}

resource "aws_s3_bucket_public_access_block" "web" {
  for_each = aws_s3_bucket.web

  bucket                  = each.value.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "web" {
  for_each = aws_s3_bucket.web

  bucket = each.value.id
  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

# trivy:ignore:AWS-0132 the bucket holds the app's public build, so S3-managed encryption is enough
resource "aws_s3_bucket_server_side_encryption_configuration" "web" {
  for_each = aws_s3_bucket.web

  bucket = each.value.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_cloudfront_origin_access_control" "web" {
  name                              = "${local.prefix}-web"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

moved {
  from = aws_cloudfront_response_headers_policy.web
  to   = aws_cloudfront_response_headers_policy.web["app"]
}

# The same headers as each nginx.conf, with what each kind of site connects to, plus HSTS.
resource "aws_cloudfront_response_headers_policy" "web" {
  for_each = local.connect

  name = each.key == "app" ? "${local.prefix}-web" : "${local.prefix}-web-${each.key}"

  security_headers_config {
    content_security_policy {
      content_security_policy = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; connect-src ${each.value}; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'"
      override                = true
    }
    content_type_options {
      override = true
    }
    referrer_policy {
      referrer_policy = "no-referrer"
      override        = true
    }
    frame_options {
      frame_option = "DENY"
      override     = true
    }
    strict_transport_security {
      access_control_max_age_sec = 31536000
      include_subdomains         = true
      preload                    = true
      override                   = true
    }
  }
}

# Pages are served by index.html, and any other /api/ path is a 404, as in nginx.conf.
resource "aws_cloudfront_function" "spa" {
  name    = "${local.prefix}-spa"
  runtime = "cloudfront-js-2.0"
  comment = "Serve the app for its pages; refuse api paths the app doesn't forward"
  publish = true
  code    = <<-JS
    function handler(event) {
      var request = event.request;
      if (request.uri.indexOf("/api/") === 0) {
        return { statusCode: 404, statusDescription: "Not Found" };
      }
      if (request.uri.indexOf(".") === -1) {
        request.uri = "/index.html";
      }
      return request;
    }
  JS
}

# trivy:ignore:AWS-0011 no WAF in the demo; every api route authenticates, and the api throttles what costs money
resource "aws_cloudfront_distribution" "web" {
  #checkov:skip=CKV_AWS_68: no WAF in the demo; every api route authenticates, and the api throttles what costs money
  #checkov:skip=CKV_AWS_86: access logs need a bucket and cost; turn them on before real users
  #checkov:skip=CKV_AWS_174: the default certificate allows only CloudFront's own TLS policy; a custom domain would set TLSv1.2_2021
  #checkov:skip=CKV_AWS_310: one origin per path is enough for a demo
  #checkov:skip=CKV_AWS_374: no geo restriction: the demo is for anyone with a test account
  #checkov:skip=CKV2_AWS_32: the response headers policy is attached to every behaviour below
  #checkov:skip=CKV2_AWS_42: no custom domain in the demo, so CloudFront's own certificate
  #checkov:skip=CKV2_AWS_47: no WAF in the demo, as above
  for_each = local.apps

  enabled             = true
  comment             = "${local.prefix}-${each.key}"
  default_root_object = "index.html"
  price_class         = "PriceClass_All"
  http_version        = "http2and3"

  origin {
    origin_id                = "web"
    domain_name              = aws_s3_bucket.web[each.key].bucket_regional_domain_name
    origin_access_control_id = aws_cloudfront_origin_access_control.web.id
  }

  dynamic "origin" {
    for_each = toset(values(each.value))
    content {
      origin_id   = origin.value
      domain_name = trimsuffix(trimprefix(data.aws_lambda_function_url.origin[origin.value].function_url, "https://"), "/")
      custom_origin_config {
        http_port                = 80
        https_port               = 443
        origin_protocol_policy   = "https-only"
        origin_ssl_protocols     = ["TLSv1.2"]
        origin_read_timeout      = 60
        origin_keepalive_timeout = 5
      }
    }
  }

  default_cache_behavior {
    target_origin_id           = "web"
    viewer_protocol_policy     = "redirect-to-https"
    allowed_methods            = ["GET", "HEAD"]
    cached_methods             = ["GET", "HEAD"]
    cache_policy_id            = local.caching_optimized
    response_headers_policy_id = aws_cloudfront_response_headers_policy.web[each.key == "home" ? "home" : "app"].id
    compress                   = true

    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.spa.arn
    }
  }

  dynamic "ordered_cache_behavior" {
    for_each = each.value
    content {
      path_pattern               = ordered_cache_behavior.key
      target_origin_id           = ordered_cache_behavior.value
      viewer_protocol_policy     = "https-only"
      allowed_methods            = ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"]
      cached_methods             = ["GET", "HEAD"]
      cache_policy_id            = local.caching_disabled
      origin_request_policy_id   = local.all_viewer_but_host
      response_headers_policy_id = aws_cloudfront_response_headers_policy.web[each.key == "home" ? "home" : "app"].id
      compress                   = true
    }
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = true
  }
}

# Only this app's distribution may read its bucket, and only over TLS.
resource "aws_s3_bucket_policy" "web" {
  for_each = aws_s3_bucket.web

  bucket = each.value.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "CloudFrontReads"
        Effect    = "Allow"
        Principal = { Service = "cloudfront.amazonaws.com" }
        Action    = "s3:GetObject"
        Resource  = "${each.value.arn}/*"
        Condition = { StringEquals = { "AWS:SourceArn" = aws_cloudfront_distribution.web[each.key].arn } }
      },
      {
        Sid       = "DenyInsecureTransport"
        Effect    = "Deny"
        Principal = "*"
        Action    = "s3:*"
        Resource  = [each.value.arn, "${each.value.arn}/*"]
        Condition = { Bool = { "aws:SecureTransport" = "false" } }
      },
    ]
  })

  depends_on = [aws_s3_bucket_public_access_block.web]
}
