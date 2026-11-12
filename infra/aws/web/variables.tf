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

variable "free_plan" {
  description = "CloudFront's flat-rate Free plan (WAF and DDoS protection) on the three apps; false where the account can't have it"
  type        = bool
  default     = true
}

variable "api_gateway" {
  description = "true: the api and Copilot are behind the functions unit's API Gateway; false: their function URLs"
  type        = bool
  default     = false
}
