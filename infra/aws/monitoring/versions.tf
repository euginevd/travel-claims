terraform {
  required_version = ">= 1.16"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "6.72.0"
    }
  }

  # The pipeline passes the bucket, region and key at init, so no account ID is in the code.
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
      Unit        = "monitoring"
      Environment = var.environment
      ManagedBy   = "Terraform"
    }
  }
}
