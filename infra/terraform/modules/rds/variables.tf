variable "name" { type = string }
variable "vpc_id" { type = string }
variable "subnet_ids" { type = list(string) }
variable "allocated_storage" { type = number }
variable "db_name" { type = string }
variable "db_username" { type = string, sensitive = true }
variable "db_password" { type = string, sensitive = true }
