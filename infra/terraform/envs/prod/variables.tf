variable "env" {
  description = "Environment name"
  type        = string
  default     = "prod"
}

variable "region" {
  description = "AWS region"
  type        = string
  default     = "eu-west-2"
}

variable "cidr_block" {
  description = "VPC CIDR"
  type        = string
  default     = "10.0.0.0/16"
}

variable "azs" {
  description = "Two AZs in region"
  type        = list(string)
  default     = ["eu-west-2a", "eu-west-2b"]
}

variable "github_org" {
  description = "GitHub org/owner"
  type        = string
}

variable "github_repo" {
  description = "GitHub repo name"
  type        = string
  default     = "forex-bot"
}

variable "oidc_provider_arn" {
  description = "ARN of GH OIDC provider (from bootstrap output)"
  type        = string
}

variable "repo_url" {
  description = "Repo URL for tagging"
  type        = string
}
