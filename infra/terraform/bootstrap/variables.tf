variable "region" {
  description = "AWS region for state buckets and OIDC provider"
  type        = string
  default     = "eu-west-2"
}

variable "github_thumbprint" {
  description = "Thumbprint of token.actions.githubusercontent.com TLS cert. Pin a known value; rotate if GitHub rotates."
  type        = string
  default     = "6938fd4d98bab03faadb97b34396831e3780aea1"
}
