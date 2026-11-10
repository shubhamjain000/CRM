output "vpc_id" {
  value = module.vpc.vpc_id
}

output "rds_endpoint" {
  value     = module.rds.endpoint
  sensitive = true
}

output "elasticache_endpoint" {
  value = module.elasticache.endpoint
}

output "s3_bucket" {
  value = module.s3.bucket_id
}

output "cloudfront_domain" {
  value = module.cloudfront.domain_name
}

output "eks_cluster_name" {
  value = module.eks.cluster_name
}
