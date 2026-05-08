variable "env" {
  description = "Environment name (prod, staging)"
  type        = string
}

variable "app_name" {
  description = "Application name (e.g. agent-runner, paper-runner)"
  type        = string
}

variable "cluster_arn" {
  description = "ECS cluster ARN (from modules/cluster)"
  type        = string
}

variable "task_execution_role_arn" {
  description = "ECS task execution role ARN (from modules/cluster)"
  type        = string
}

variable "service_connect_namespace_arn" {
  description = "Service Connect HTTP namespace ARN (from modules/cluster)"
  type        = string
}

variable "vpc_subnet_ids" {
  description = "Subnet IDs for the service"
  type        = list(string)
}

variable "app_sg_id" {
  description = "Application security group; service joins it"
  type        = string
}

variable "ecr_repo_url" {
  description = "ECR repository URL"
  type        = string
}

variable "image_tag" {
  description = "Container image tag deployed to the cluster"
  type        = string
  default     = "latest"
}

variable "cpu" {
  description = "Fargate CPU units (string, e.g. \"512\")"
  type        = string
  default     = "512"
}

variable "memory" {
  description = "Fargate memory in MB (string, e.g. \"1024\")"
  type        = string
  default     = "1024"
}

variable "secret_arn" {
  description = "ARN of the Secrets Manager blob"
  type        = string
}

variable "secret_keys" {
  description = "Secret keys to inject as env vars. Each item: { env_name, json_key }."
  type = list(object({
    env_name = string
    json_key = string
  }))
  default = []
}

variable "env_vars" {
  description = "Plain-text environment variables (map)"
  type        = map(string)
  default     = {}
}

variable "extra_iam_policy_arns" {
  description = "Additional IAM policy ARNs attached to the task role"
  type        = list(string)
  default     = []
}

variable "secrets_read_policy_arn" {
  description = "Secrets-read policy ARN from modules/secrets (always attached to task role)"
  type        = string
}

variable "desired_count" {
  description = "Number of running tasks"
  type        = number
  default     = 1
}

variable "enable_execute_command" {
  description = "Enable `aws ecs execute-command` for debugging"
  type        = bool
  default     = true
}

variable "common_tags" {
  description = "Tags applied to every resource"
  type        = map(string)
}
