resource "aws_ecr_repository" "backend" {
  name                 = "unirise-backend"
  image_tag_mutability = "MUTABLE" # dev only
  image_scanning_configuration { scan_on_push = true }
}

resource "aws_ecr_lifecycle_policy" "backend" {
  repository = aws_ecr_repository.backend.name
  policy = jsonencode({
    # The nightly backup's image (tag db-admin-*) is pinned in its task definition, so it must never be expired by the
    # general rule (it was on 2026-11-24, and backups stopped). Rule 1 claims db-admin images and keeps the newest 5;
    # an image matched by rule 1 is never expired by rule 2.
    rules = [{
      rulePriority = 1
      description  = "Keep the 5 most recent database-admin (backup) images"
      selection    = { tagStatus = "tagged", tagPrefixList = ["db-admin"], countType = "imageCountMoreThan", countNumber = 5 }
      action       = { type = "expire" }
      }, {
      rulePriority = 2
      description  = "Keep the 20 most recent other images"
      selection    = { tagStatus = "any", countType = "imageCountMoreThan", countNumber = 20 }
      action       = { type = "expire" }
    }]
  })
}

resource "aws_cloudwatch_log_group" "app" {
  name              = "/unirise/dev/app"
  retention_in_days = 14
}
