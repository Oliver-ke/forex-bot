variable "env" {
  description = "Environment name"
  type        = string
}

variable "subnet_ids" {
  description = "Subnet IDs for RDS + ElastiCache subnet groups"
  type        = list(string)
}

variable "data_sg_id" {
  description = "Security group ID controlling ingress to RDS + Redis"
  type        = string
}

variable "db_password" {
  description = "RDS master password"
  type        = string
  sensitive   = true
}

variable "common_tags" {
  description = "Tags applied to every resource"
  type        = map(string)
}
