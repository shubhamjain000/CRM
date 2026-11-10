variable "name" { type = string }
variable "vpc_id" { type = string }
variable "subnet_ids" { type = list(string) }
variable "cluster_version" { type = string }
variable "node_min" { type = number }
variable "node_max" { type = number }
