variable "env" {
  description = "Environment name (prod, staging)"
  type        = string
}

variable "cidr_block" {
  description = "VPC CIDR block"
  type        = string
}

variable "azs" {
  description = "Availability zones (length 2)"
  type        = list(string)
  validation {
    condition     = length(var.azs) == 2
    error_message = "azs must have exactly 2 entries."
  }
}

variable "common_tags" {
  description = "Tags applied to every resource"
  type        = map(string)
}
