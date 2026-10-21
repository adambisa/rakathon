variable "site_hostname" {
  description = "Public DNS name; Vercel points it at the ALB with a CNAME."
  type        = string
  default     = "rakathon.example.com"
  validation {
    condition     = can(regex("^[a-z0-9][a-z0-9.-]+\\.[a-z]{2,}$", var.site_hostname))
    error_message = "Supply a lowercase DNS hostname without a scheme or path."
  }
}

variable "extraction_reader" {
  description = "Reader for scanned report pages: tesseract or bedrock-mantle. Gemma is off for now; sector sheets never use a reader."
  type        = string
  default     = "tesseract"

  validation {
    condition     = contains(["tesseract", "bedrock-mantle"], var.extraction_reader)
    error_message = "Choose tesseract or bedrock-mantle."
  }
}

variable "extraction_model" {
  description = "Bedrock Mantle vision model used by the bedrock-mantle reader."
  type        = string
  default     = "google.gemma-4-e2b"
}
