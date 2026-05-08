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

output "ecs_cluster_name" {
  value = module.cluster.cluster_name
}

output "sidecar_service_name" {
  value = module.sidecar.service_name
}

output "sidecar_log_group_name" {
  value = module.sidecar.log_group_name
}

output "paper_runner_service_name" {
  value = module.paper_runner.service_name
}

output "paper_runner_task_role_arn" {
  value = module.paper_runner.task_role_arn
}

output "paper_runner_log_group_name" {
  value = module.paper_runner.log_group_name
}

output "db_password" {
  value     = random_password.db.result
  sensitive = true
}
