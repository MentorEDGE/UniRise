#!/usr/bin/env bash
# Builds an arm64 image and pushes it to the UniRise dev ECR repository.
# Usage: scripts/push-image.sh [api|db-admin]      Needs AWS credentials and Docker.
set -euo pipefail
target="${1:-api}"
case "$target" in api|db-admin) ;; *) echo "expected api or db-admin" >&2; exit 2 ;; esac
root="$(cd "$(dirname "$0")/.." && pwd)"
region="${AWS_REGION:-ap-south-1}"
account="$(aws sts get-caller-identity --query Account --output text)"
[[ "$account" == 417441726165 && "$region" == ap-south-1 ]] || { echo "expected the UniRise AWS account and Mumbai region" >&2; exit 1; }
repo="${ECR_REPO:-unirise-backend}"
tag="$(git rev-parse --short HEAD)"
[[ "$target" == api ]] || tag="db-admin-$tag"
uri="${account}.dkr.ecr.${region}.amazonaws.com/${repo}"
aws ecr get-login-password --region "$region" | docker login --username AWS --password-stdin "${account}.dkr.ecr.${region}.amazonaws.com"
if [[ "$target" == api ]]; then
  docker build --platform linux/arm64 -t "${uri}:${tag}" "$root/unirise-api"
else
  docker build --platform linux/arm64 -f "$root/scripts/db-admin/Dockerfile" -t "${uri}:${tag}" "$root"
fi
docker push "${uri}:${tag}"
echo "pushed ${uri}:${tag}"
