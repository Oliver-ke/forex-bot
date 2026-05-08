output "pg_endpoint" {
  value = aws_db_instance.pg.address
}

output "pg_port" {
  value = aws_db_instance.pg.port
}

output "redis_endpoint" {
  value = aws_elasticache_cluster.redis.cache_nodes[0].address
}

output "redis_port" {
  value = aws_elasticache_cluster.redis.port
}

output "journal_table_name" {
  value = aws_dynamodb_table.trade_journal.name
}

output "journal_table_arn" {
  value = aws_dynamodb_table.trade_journal.arn
}

output "killswitch_table_name" {
  value = aws_dynamodb_table.kill_switch.name
}

output "killswitch_table_arn" {
  value = aws_dynamodb_table.kill_switch.arn
}

output "journal_rw_policy_arn" {
  value = aws_iam_policy.journal_rw.arn
}

output "killswitch_rw_policy_arn" {
  value = aws_iam_policy.killswitch_rw.arn
}
