terraform {
  required_version = ">= 1.7.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  backend "s3" {
    bucket         = "foundation-tf-state"
    key            = "terraform.tfstate"
    region         = "us-east-1"
    dynamodb_table = "foundation-tf-locks"
    encrypt        = true
  }
}

provider "aws" {
  region = var.aws_region
}

# --- Network ---
module "vpc" {
  source = "./modules/vpc"

  name              = "${var.project}-${var.environment}"
  cidr              = var.vpc_cidr
  azs               = var.azs
  enable_nat_gateway = var.environment != "dev"
}

# --- Data ---
module "rds" {
  source = "./modules/rds"

  name              = "${var.project}-${var.environment}"
  vpc_id            = module.vpc.vpc_id
  subnet_ids        = module.vpc.private_subnet_ids
  allocated_storage = var.rds_storage
  db_name           = var.project
  db_username       = var.rds_username
  db_password       = var.rds_password
}

module "elasticache" {
  source = "./modules/elasticache"

  name        = "${var.project}-${var.environment}"
  vpc_id      = module.vpc.vpc_id
  subnet_ids  = module.vpc.private_subnet_ids
  node_type   = var.cache_node_type
}

# --- Storage / CDN ---
module "s3" {
  source = "./modules/s3"

  bucket       = "${var.project}-${var.environment}-media"
  force_destroy = var.environment != "prod"
}

module "cloudfront" {
  source = "./modules/cloudfront"

  origin_domain = module.s3.bucket_regional_domain_name
  price_class   = var.environment == "prod" ? "PriceClass_All" : "PriceClass_100"
}

# --- Compute ---
module "eks" {
  source = "./modules/eks"

  name           = "${var.project}-${var.environment}"
  vpc_id         = module.vpc.vpc_id
  subnet_ids     = module.vpc.private_subnet_ids
  cluster_version = var.eks_version
  node_min       = var.eks_node_min
  node_max       = var.eks_node_max
}
