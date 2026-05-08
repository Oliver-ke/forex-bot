terraform {
  required_version = ">= 1.10"
  required_providers {
    aws    = { source = "hashicorp/aws", version = "~> 5.70" }
    random = { source = "hashicorp/random", version = "~> 3.6" }
  }

  backend "s3" {
    bucket       = "forex-bot-tfstate-staging"
    key          = "infra/main.tfstate"
    region       = "eu-west-2"
    encrypt      = true
    use_lockfile = true
  }
}

locals {
  common_tags = {
    Project     = "forex-bot"
    Environment = var.env
    ManagedBy   = "terraform"
    Repo        = var.repo_url
  }
}

provider "aws" {
  region = var.region
  default_tags { tags = local.common_tags }
}

resource "random_password" "db" {
  length           = 32
  special          = true
  override_special = "!#$%&*()-_=+[]{}<>?"
}

module "network" {
  source      = "../../modules/network"
  env         = var.env
  cidr_block  = var.cidr_block
  azs         = var.azs
  common_tags = local.common_tags
}

module "secrets" {
  source      = "../../modules/secrets"
  env         = var.env
  db_password = random_password.db.result
  common_tags = local.common_tags
}

module "data" {
  source      = "../../modules/data"
  env         = var.env
  subnet_ids  = module.network.public_subnet_ids
  data_sg_id  = module.network.data_sg_id
  db_password = random_password.db.result
  common_tags = local.common_tags
}

module "ecr" {
  source      = "../../modules/ecr"
  env         = var.env
  common_tags = local.common_tags
}

module "ci_oidc" {
  source            = "../../modules/ci-oidc"
  env               = var.env
  github_org        = var.github_org
  github_repo       = var.github_repo
  branch_filters    = ["pull_request", "ref:refs/heads/main"]
  oidc_provider_arn = var.oidc_provider_arn
  ecr_repo_arns     = values(module.ecr.repo_arns)
  common_tags       = local.common_tags
}

module "cluster" {
  source                  = "../../modules/cluster"
  env                     = var.env
  secrets_read_policy_arn = module.secrets.read_policy_arn
  common_tags             = local.common_tags
}

module "sidecar" {
  source                        = "../../modules/sidecar"
  env                           = var.env
  cluster_arn                   = module.cluster.cluster_arn
  task_execution_role_arn       = module.cluster.task_execution_role_arn
  service_connect_namespace_arn = module.cluster.service_connect_namespace_arn
  secrets_read_policy_arn       = module.secrets.read_policy_arn
  secret_arn                    = module.secrets.secret_arn
  vpc_subnet_ids                = module.network.public_subnet_ids
  app_sg_id                     = module.network.app_sg_id
  ecr_repo_url                  = module.ecr.repo_urls["mt5-sidecar"]
  common_tags                   = local.common_tags
}

module "paper_runner" {
  source                        = "../../modules/app"
  env                           = var.env
  app_name                      = "paper-runner"
  cluster_arn                   = module.cluster.cluster_arn
  task_execution_role_arn       = module.cluster.task_execution_role_arn
  service_connect_namespace_arn = module.cluster.service_connect_namespace_arn
  vpc_subnet_ids                = module.network.public_subnet_ids
  app_sg_id                     = module.network.app_sg_id
  ecr_repo_url                  = module.ecr.repo_urls["paper-runner"]
  cpu                           = "512"
  memory                        = "1024"
  secret_arn                    = module.secrets.secret_arn
  secrets_read_policy_arn       = module.secrets.read_policy_arn
  secret_keys = [
    { env_name = "ANTHROPIC_API_KEY", json_key = "anthropicApiKey" },
  ]
  env_vars = {
    MT5_HOST         = "mt5-sidecar"
    MT5_PORT         = "50051"
    MT5_DEMO         = "1"
    PAPER_MODE       = "1"
    PAPER_BUDGET_USD = "50"
    PAPER_OUT_DIR    = "/tmp/paper-out"
    REDIS_URL        = "redis://${module.data.redis_endpoint}:${module.data.redis_port}"
    REDIS_NAMESPACE  = "forex-bot"
    WATCHED_SYMBOLS  = "EURUSD,USDJPY"
    POLL_MS          = "60000"
    JOURNAL_TABLE    = module.data.journal_table_name
    KILLSWITCH_TABLE = module.data.killswitch_table_name
    AWS_REGION       = "eu-west-2"
  }
  extra_iam_policy_arns = [
    module.data.journal_rw_policy_arn,
    module.data.killswitch_rw_policy_arn,
  ]
  common_tags = local.common_tags
}
