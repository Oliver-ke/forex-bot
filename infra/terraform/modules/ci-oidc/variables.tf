variable "env" {
  description = "Environment name"
  type        = string
}

variable "github_org" {
  description = "GitHub org/owner for the forex-bot repo"
  type        = string
}

variable "github_repo" {
  description = "GitHub repo name (without org)"
  type        = string
  default     = "forex-bot"
}

variable "branch_filter" {
  description = "GitHub Actions sub-claim filter (e.g. 'ref:refs/heads/main' or 'pull_request')"
  type        = string
}

variable "oidc_provider_arn" {
  description = "ARN of token.actions.githubusercontent.com OIDC provider (from bootstrap)"
  type        = string
}

variable "ecr_repo_arns" {
  description = "ECR repository ARNs the CI role may push to"
  type        = list(string)
}

variable "common_tags" {
  description = "Tags applied to every resource"
  type        = map(string)
}
