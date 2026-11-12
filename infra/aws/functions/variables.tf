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

variable "sonnet_model" {
  description = "A Bedrock model or inference profile ID for Claude Sonnet; found in the region when empty"
  type        = string
  default     = ""
}

variable "haiku_model" {
  description = "A Bedrock model or inference profile ID for Claude Haiku; found in the region when empty"
  type        = string
  default     = ""
}


variable "model_provider" {
  description = "Which Claude the apps call: anthropic (the key from GitHub secrets) or bedrock (Australia's profiles)"
  type        = string
  default     = "bedrock"

  validation {
    condition     = contains(["anthropic", "bedrock"], var.model_provider)
    error_message = "model_provider is anthropic or bedrock."
  }
}

variable "database_app_role" {
  description = "true: the api serves requests through a DSQL role that can only read and write the app's tables, not admin"
  type        = bool
  default     = false
}
