# Receipts read into fields before any model sees them (decisions 48 and 50): Bedrock Data
# Automation by default, a synchronous project with AWS's Receipt blueprint; from Sydney its
# Asia Pacific profile may process a receipt in any of these Regions. RECEIPT_READER=textract
# keeps receipts in Sydney instead, as real claim data would need.
locals {
  data_automation_regions = ["ap-northeast-1", "ap-northeast-2", "ap-northeast-3", "ap-south-1", "ap-south-2", "ap-southeast-1", "ap-southeast-2", "ap-southeast-4"]
}

resource "awscc_bedrock_data_automation_project" "receipts" {
  count = var.receipt_reader == "data-automation" ? 1 : 0

  project_name        = "${local.prefix}-receipts"
  project_description = "Reads claim receipts into fields for the ${var.project} claim agent"
  project_type        = "SYNC"

  custom_output_configuration = {
    blueprints = [{
      blueprint_arn   = "arn:${local.partition}:bedrock:${local.region}:aws:blueprint/bedrock-data-automation-public-receipt"
      blueprint_stage = "LIVE"
    }]
  }

  # Required, kept to the least: the receipt's text, no summaries or extra files.
  standard_output_configuration = {
    document = {
      extraction = {
        granularity  = { types = ["PAGE"] }
        bounding_box = { state = "DISABLED" }
      }
      generative_field = { state = "DISABLED" }
      output_format = {
        text_format            = { types = ["PLAIN_TEXT"] }
        additional_file_format = { state = "DISABLED" }
      }
    }
    image = {
      extraction = {
        # At least one image option is required; the receipt's text is the useful one.
        category     = { state = "ENABLED", types = ["TEXT_DETECTION"] }
        bounding_box = { state = "DISABLED" }
      }
      generative_field = { state = "DISABLED", types = [] }
    }
  }
}
