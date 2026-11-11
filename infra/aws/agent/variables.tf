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


variable "code_execution" {
  description = "Whether the agent may run lookup programs on AgentCore Code Interpreter (plan phase 5); off until evaluated"
  type        = bool
  default     = false
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

variable "api_gateway" {
  description = "true: the api and Copilot are behind the functions unit's API Gateway; false: their function URLs"
  type        = bool
  default     = false
}
