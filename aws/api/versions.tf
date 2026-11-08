terraform {
  required_version = ">= 1.17"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "6.72.0"
    }
    archive = {
      source  = "hashicorp/archive"
      version = "2.7.1"
    }
  }

  # The pipeline passes the bucket and key at init, so no project name or account ID is in the code:
  # terraform init -backend-config="bucket=$TF_STATE_BUCKET" -backend-config="key=$PROJECT_NAME/<unit>.tfstate"
  backend "s3" {
    region       = "ap-southeast-2"
    use_lockfile = true
    encrypt      = true
  }
}

provider "aws" {
  region = var.region

  default_tags {
    tags = {
      Project     = var.project
      Unit        = "api"
      Environment = var.environment
      ManagedBy   = "Terraform"
    }
  }
}
