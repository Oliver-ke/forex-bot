output "state_bucket_prod" {
  value = aws_s3_bucket.tfstate["prod"].bucket
}

output "state_bucket_staging" {
  value = aws_s3_bucket.tfstate["staging"].bucket
}

output "oidc_provider_arn" {
  value = aws_iam_openid_connect_provider.github.arn
}
