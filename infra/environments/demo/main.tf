terraform {
  required_version = "~> 1.16.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
    archive = {
      source  = "hashicorp/archive"
      version = "~> 2.7"
    }
  }
}

provider "aws" {
  region              = "eu-central-1"
  allowed_account_ids = ["000000000000"]

  default_tags {
    tags = {
      Project     = "prostapaper"
      ManagedBy   = "terraform"
      Environment = "demo"
    }
  }
}
