variable "env" {
  description = "Environment name"
  type        = string
}

variable "apps" {
  description = "App names for which to create ECR repos"
  type        = list(string)
  default = [
    "mt5-sidecar",
    "agent-runner",
    "paper-runner",
    "data-ingest",
    "eval-replay-cli",
    "eval-event-study-cli",
  ]
}

variable "common_tags" {
  description = "Tags applied to every resource"
  type        = map(string)
}
