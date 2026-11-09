# Set by the pipeline from repository variables: TF_VAR_project and TF_VAR_environment.
variable "project" {
  description = "Project name, the prefix for every resource name"
  type        = string
}

variable "environment" {
  description = "Deployment target, such as dev or prod"
  type        = string
}

variable "region" {
  description = "AWS region"
  type        = string
  default     = "ap-southeast-2"
}

variable "enabled" {
  description = "Whether the apps name the guardrail on every model call; off until it's checked against the hidden-instruction check on Bedrock"
  type        = bool
  default     = false
}
