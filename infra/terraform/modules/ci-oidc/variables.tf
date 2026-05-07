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

variable "branch_filters" {
  description = "List of GitHub Actions sub-claim suffixes (e.g. ['ref:refs/heads/main', 'pull_request']). At least one entry required."
  type        = list(string)

  validation {
    condition     = length(var.branch_filters) > 0
    error_message = "branch_filters must contain at least one entry."
  }
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
