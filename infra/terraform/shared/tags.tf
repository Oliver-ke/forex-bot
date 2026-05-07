# Sourced by every env stack (envs/<env>/main.tf) via a `module "tags"` style
# include OR by passing `var.env` to each module. We use the latter; this file
# documents the convention and is referenced by the README.

# locals.common_tags is replicated inline in each env's main.tf because Terraform
# does not allow a `locals {}` block to be shared across modules without making
# it an input variable. Convention used in every env:
#
#   locals {
#     common_tags = {
#       Project     = "forex-bot"
#       Environment = var.env
#       ManagedBy   = "terraform"
#       Repo        = var.repo_url
#     }
#   }
#
# Provider default_tags is set in each env to apply common_tags repo-wide.
