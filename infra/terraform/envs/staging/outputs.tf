output "vpc_id" {
  value = module.network.vpc_id
}

output "pg_endpoint" {
  value = module.data.pg_endpoint
}

output "redis_endpoint" {
  value = module.data.redis_endpoint
}

output "secret_arn" {
  value = module.secrets.secret_arn
}

output "secrets_read_policy_arn" {
  value = module.secrets.read_policy_arn
}

output "ecr_repo_urls" {
  value = module.ecr.repo_urls
}

output "ci_role_arn" {
  value = module.ci_oidc.ci_role_arn
}
