locals {
  buckets = {
    uploads = { versioned = true, expire_days = 0 }   # PDFs and enclosures
    exports = { versioned = false, expire_days = 30 } # generated CSV and PDF exports expire
  }
}

resource "aws_s3_bucket" "b" {
  for_each = local.buckets
  bucket   = "${local.name}-${each.key}-${local.account_id}"
}

resource "aws_s3_bucket_public_access_block" "b" {
  for_each                = local.buckets
  bucket                  = aws_s3_bucket.b[each.key].id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "b" {
  for_each = local.buckets
  bucket   = aws_s3_bucket.b[each.key].id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_versioning" "b" {
  for_each = local.buckets
  bucket   = aws_s3_bucket.b[each.key].id
  versioning_configuration { status = each.value.versioned ? "Enabled" : "Suspended" }
}

resource "aws_s3_bucket_lifecycle_configuration" "b" {
  for_each = local.buckets
  bucket   = aws_s3_bucket.b[each.key].id
  rule {
    id     = "housekeeping"
    status = "Enabled"
    filter {}
    abort_incomplete_multipart_upload { days_after_initiation = 7 }
    dynamic "noncurrent_version_expiration" {
      for_each = each.value.versioned ? [1] : []
      content { noncurrent_days = 30 }
    }
    dynamic "expiration" {
      for_each = each.value.expire_days > 0 ? [1] : []
      content { days = each.value.expire_days }
    }
  }
  depends_on = [aws_s3_bucket_versioning.b]
}

data "aws_iam_policy_document" "tls_only" {
  for_each = local.buckets
  statement {
    sid       = "DenyInsecureTransport"
    effect    = "Deny"
    actions   = ["s3:*"]
    resources = [aws_s3_bucket.b[each.key].arn, "${aws_s3_bucket.b[each.key].arn}/*"]
    principals {
      type        = "*"
      identifiers = ["*"]
    }
    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }
}

resource "aws_s3_bucket_policy" "b" {
  for_each   = local.buckets
  bucket     = aws_s3_bucket.b[each.key].id
  policy     = data.aws_iam_policy_document.tls_only[each.key].json
  depends_on = [aws_s3_bucket_public_access_block.b]
}
