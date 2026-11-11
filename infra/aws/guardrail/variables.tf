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

variable "enabled" {
  description = "Whether the agent screens customer text with the guardrail; on since the red team held 8 of 8 on AWS (2026-11-10)"
  type        = bool
  default     = true
}
