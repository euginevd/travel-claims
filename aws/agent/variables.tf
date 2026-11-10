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
  description = "Which Claude the apps call: anthropic (the API key in the app secret) or bedrock (Australia's profiles)"
  type        = string
  default     = "bedrock"

  validation {
    condition     = contains(["anthropic", "bedrock"], var.model_provider)
    error_message = "model_provider is anthropic or bedrock."
  }
}

variable "code_execution" {
  description = "Whether the agent may run lookup programs on AgentCore Code Interpreter (plan phase 5); off until evaluated"
  type        = bool
  default     = false
}
