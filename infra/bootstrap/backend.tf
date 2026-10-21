terraform {
  backend "s3" {
    bucket       = "prostapaper-tfstate-000000000000-eu-central-1"
    key          = "bootstrap/terraform.tfstate"
    region       = "eu-central-1"
    encrypt      = true
    use_lockfile = true
  }
}
