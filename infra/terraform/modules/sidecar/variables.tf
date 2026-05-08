variable "env" {
  description = "Environment name"
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

variable "secrets_read_policy_arn" {
  description = "IAM policy ARN granting read on the env Secrets Manager blob (from modules/secrets)"
  type        = string
}

variable "secret_arn" {
  description = "ARN of the Secrets Manager blob (used for valueFrom references)"
  type        = string
}

variable "vpc_subnet_ids" {
  description = "Subnet IDs in which the sidecar service runs"
  type        = list(string)
}

variable "app_sg_id" {
  description = "Application security group; sidecar joins it (intra-app ingress + wide egress)"
  type        = string
}

variable "ecr_repo_url" {
  description = "ECR repository URL (e.g. 1234.dkr.ecr.eu-west-2.amazonaws.com/forex-bot/staging/mt5-sidecar)"
  type        = string
}

variable "image_tag" {
  description = "Image tag deployed to the cluster"
  type        = string
  default     = "latest"
}

variable "common_tags" {
  description = "Tags applied to every resource"
  type        = map(string)
}

variable "service_connect_namespace_arn" {
  description = "ARN of the Service Connect HTTP namespace from modules/cluster. If null, sidecar does not register."
  type        = string
  default     = null
}
