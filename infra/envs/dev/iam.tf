# The AWS account is shared with other projects, so every permission below is scoped to resources named or tagged for UniRise.
# Users are created WITHOUT passwords or access keys so no secret lands in Terraform state. See infra/README.md for how to
# give someone console access. Everyone must set up MFA before they can do anything else.
resource "aws_iam_group" "developers" {
  name = "unirise-developers"
  path = "/unirise/"
}

resource "aws_iam_group" "admins" {
  name = "unirise-admins"
  path = "/unirise/"
}

resource "aws_iam_user" "developer" {
  for_each = toset(var.developers)
  name     = each.value
  path     = "/unirise/"
}

resource "aws_iam_user" "admin" {
  for_each = toset(var.admins)
  name     = each.value
  path     = "/unirise/"
}

resource "aws_iam_user_group_membership" "developer" {
  for_each = aws_iam_user.developer
  user     = each.value.name
  groups   = [aws_iam_group.developers.name]
}

resource "aws_iam_user_group_membership" "admin" {
  for_each = aws_iam_user.admin
  user     = each.value.name
  groups   = [aws_iam_group.admins.name]
}

# --- MFA: allow only self-service MFA setup until the person has signed in with MFA ---
data "aws_iam_policy_document" "require_mfa" {
  statement {
    sid    = "ManageOwnMfaAndPassword"
    effect = "Allow"
    actions = [
      "iam:ChangePassword", "iam:GetUser", "iam:CreateVirtualMFADevice", "iam:DeleteVirtualMFADevice",
      "iam:EnableMFADevice", "iam:DeactivateMFADevice", "iam:ResyncMFADevice", "iam:ListMFADevices",
    ]
    resources = [
      "arn:aws:iam::${local.account_id}:user/unirise/$${aws:username}",
      "arn:aws:iam::${local.account_id}:mfa/$${aws:username}",
    ]
  }
  statement {
    sid       = "ListVirtualMfaDevices"
    effect    = "Allow"
    actions   = ["iam:ListVirtualMFADevices"]
    resources = ["*"]
  }
  statement {
    sid    = "DenyEverythingElseWithoutMfa"
    effect = "Deny"
    not_actions = [
      "iam:CreateVirtualMFADevice", "iam:EnableMFADevice", "iam:GetUser", "iam:ListMFADevices", "iam:ListVirtualMFADevices",
      "iam:ResyncMFADevice", "iam:ChangePassword", "sts:GetSessionToken",
    ]
    resources = ["*"]
    condition {
      test     = "BoolIfExists"
      variable = "aws:MultiFactorAuthPresent"
      values   = ["false"]
    }
  }
}

resource "aws_iam_policy" "require_mfa" {
  name   = "unirise-require-mfa"
  path   = "/unirise/"
  policy = data.aws_iam_policy_document.require_mfa.json
}

# --- Developers: use dev data stores, push images and read logs. Privileged DB tasks are operator-only. ---
data "aws_iam_policy_document" "developer" {
  statement {
    sid       = "ListUniRiseBuckets"
    actions   = ["s3:ListBucket", "s3:GetBucketLocation"]
    resources = [for b in aws_s3_bucket.b : b.arn]
  }
  statement {
    sid       = "UseUniRiseBucketObjects"
    actions   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject", "s3:AbortMultipartUpload", "s3:ListMultipartUploadParts"]
    resources = [for b in aws_s3_bucket.b : "${b.arn}/*"]
  }
  dynamic "statement" {
    for_each = local.ses_on ? [1] : []
    content {
      sid       = "SendMailFromUniRiseIdentity"
      actions   = ["ses:SendEmail", "ses:SendRawEmail"]
      resources = concat(local.email_on ? [aws_sesv2_email_identity.sender[0].arn] : [], local.domain_on ? [aws_sesv2_email_identity.domain[0].arn] : [], [aws_sesv2_configuration_set.main[0].arn])
    }
  }
  statement {
    sid       = "ConnectToDatabaseAsDeveloperUser"
    actions   = ["rds-db:connect"]
    resources = ["arn:aws:rds-db:${var.region}:${local.account_id}:dbuser:${aws_db_instance.main.resource_id}/${var.developer_db_user}"]
  }
  statement {
    sid       = "DescribeDatabase"
    actions   = ["rds:DescribeDBInstances", "rds:DescribeDBSnapshots"]
    resources = ["*"]
  }
  statement {
    sid       = "ReadUniRiseLogs"
    actions   = ["logs:DescribeLogStreams", "logs:GetLogEvents", "logs:FilterLogEvents", "logs:StartLiveTail"]
    resources = ["${aws_cloudwatch_log_group.app.arn}", "${aws_cloudwatch_log_group.app.arn}:*"]
  }
  statement {
    sid       = "DescribeLogGroups"
    actions   = ["logs:DescribeLogGroups"]
    resources = ["*"]
  }
  statement {
    sid       = "EcrLogin"
    actions   = ["ecr:GetAuthorizationToken"]
    resources = ["*"]
  }
  statement {
    sid = "EcrPushPull"
    actions = [
      "ecr:BatchCheckLayerAvailability", "ecr:BatchGetImage", "ecr:GetDownloadUrlForLayer", "ecr:InitiateLayerUpload",
      "ecr:UploadLayerPart", "ecr:CompleteLayerUpload", "ecr:PutImage", "ecr:DescribeImages",
    ]
    resources = [aws_ecr_repository.backend.arn]
  }

}

resource "aws_iam_policy" "developer" {
  name   = "unirise-developer"
  path   = "/unirise/"
  policy = data.aws_iam_policy_document.developer.json
}

resource "aws_iam_group_policy_attachment" "developer_main" {
  group      = aws_iam_group.developers.name
  policy_arn = aws_iam_policy.developer.arn
}

resource "aws_iam_group_policy_attachment" "developer_mfa" {
  group      = aws_iam_group.developers.name
  policy_arn = aws_iam_policy.require_mfa.arn
}

# --- Admins: AdministratorAccess to the whole account. Use sparingly; add people only when they must run Terraform. ---
resource "aws_iam_group_policy_attachment" "admin_main" {
  group      = aws_iam_group.admins.name
  policy_arn = "arn:aws:iam::aws:policy/AdministratorAccess"
}

resource "aws_iam_group_policy_attachment" "admin_mfa" {
  group      = aws_iam_group.admins.name
  policy_arn = aws_iam_policy.require_mfa.arn
}
