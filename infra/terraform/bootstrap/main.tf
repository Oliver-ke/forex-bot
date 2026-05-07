terraform {
  required_version = ">= 1.10"
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 5.70" }
  }
}

provider "aws" {
  region = var.region

  default_tags {
    tags = {
      Project   = "forex-bot"
      ManagedBy = "terraform"
      Stack     = "bootstrap"
    }
  }
}

locals {
  envs = ["prod", "staging"]
}

resource "aws_s3_bucket" "tfstate" {
  for_each = toset(local.envs)
  bucket   = "forex-bot-tfstate-${each.value}"
}

resource "aws_s3_bucket_versioning" "tfstate" {
  for_each = aws_s3_bucket.tfstate
  bucket   = each.value.id
  versioning_configuration { status = "Enabled" }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "tfstate" {
  for_each = aws_s3_bucket.tfstate
  bucket   = each.value.id
  rule {
    apply_server_side_encryption_by_default { sse_algorithm = "AES256" }
  }
}

resource "aws_s3_bucket_public_access_block" "tfstate" {
  for_each                = aws_s3_bucket.tfstate
  bucket                  = each.value.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_lifecycle_configuration" "tfstate" {
  for_each = aws_s3_bucket.tfstate
  bucket   = each.value.id
  rule {
    id     = "expire-noncurrent"
    status = "Enabled"
    filter {}
    noncurrent_version_expiration { noncurrent_days = 90 }
  }
}

resource "aws_iam_openid_connect_provider" "github" {
  url             = "https://token.actions.githubusercontent.com"
  client_id_list  = ["sts.amazonaws.com"]
  thumbprint_list = [var.github_thumbprint]
}
