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

# Staff sign-in through the company's Okta, off until the pipeline names its SAML metadata (decision 44).
variable "staff_saml_metadata_url" {
  description = "The Okta SAML app's metadata URL for the staff and engineering pools; off when empty"
  type        = string
  default     = ""
}

variable "staff_sign_in_urls" {
  description = "Comma-separated addresses the dashboard and console come back to after a company sign-in"
  type        = string
  default     = ""
}

variable "staff_sso_group_ids" {
  description = "Comma-separated id=group pairs naming the identity provider's group IDs as the apps' groups (handlers, engineers); empty when it sends names, as Okta does"
  type        = string
  default     = ""
}
