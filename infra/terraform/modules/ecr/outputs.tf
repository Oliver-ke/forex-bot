output "repo_urls" {
  value = { for k, v in aws_ecr_repository.app : k => v.repository_url }
}

output "repo_arns" {
  value = { for k, v in aws_ecr_repository.app : k => v.arn }
}

output "repo_names" {
  value = { for k, v in aws_ecr_repository.app : k => v.name }
}
