output "cluster_arn" {
  value = aws_ecs_cluster.main.arn
}

output "cluster_name" {
  value = aws_ecs_cluster.main.name
}

output "task_execution_role_arn" {
  value = aws_iam_role.task_execution.arn
}

output "service_connect_namespace_arn" {
  value = aws_service_discovery_http_namespace.main.arn
}
