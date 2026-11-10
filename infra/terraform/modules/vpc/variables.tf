variable "name" { type = string }
variable "cidr" { type = string }
variable "azs" { type = list(string) }
variable "enable_nat_gateway" { type = bool, default = true }
