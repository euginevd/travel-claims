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

variable "alert_email" {
  description = "Where the budget alert is emailed; empty sends none"
  type        = string
  default     = ""
}

variable "monthly_budget" {
  description = "Monthly cost in USD that triggers the budget alert"
  type        = number
  default     = 10
}

variable "access_analyzer" {
  description = "IAM Access Analyzer for the account; false if the account already has one here"
  type        = bool
  default     = true
}
