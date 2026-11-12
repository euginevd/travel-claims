# Set by the pipeline from repository variables: TF_VAR_project and TF_VAR_environment.
variable "project" {
  description = "Project name, the prefix for every resource name"
  type        = string
}

variable "environment" {
  description = "Deployment target: dev"
  type        = string
}

variable "region" {
  description = "AWS region"
  type        = string
  default     = "ap-southeast-2"
}

variable "cloudfront_waf" {
  description = "on: the platform's Firewall Manager applies its WAF policy to the sites (recommended); off: no WAF, the prototype's cost-optimized default"
  type        = string
  default     = "off"

  validation {
    condition     = contains(["on", "off"], var.cloudfront_waf)
    error_message = "cloudfront_waf is on or off."
  }
}

variable "api_gateway" {
  description = "true: the api and Copilot are behind the functions unit's API Gateway; false: their function URLs"
  type        = bool
  default     = false
}
