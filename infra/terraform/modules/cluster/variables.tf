variable "env" {
  description = "Environment name (prod, staging)"
  type        = string
}

variable "secrets_read_policy_arn" {
  description = "ARN of the IAM policy granting read access to the env's Secrets Manager blob (from modules/secrets)"
  type        = string
}

variable "common_tags" {
  description = "Tags applied to every resource"
  type        = map(string)
}
