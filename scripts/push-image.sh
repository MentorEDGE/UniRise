#!/usr/bin/env bash
# Builds the API image for Fargate (arm64) and pushes it to the UniRise dev ECR repository.
# Usage: scripts/push-image.sh      Needs AWS credentials (a unirise-developers login with MFA) and Docker.
set -euo pipefail
region="${AWS_REGION:-ap-south-1}"
account="$(aws sts get-caller-identity --query Account --output text)"
repo="${ECR_REPO:-unirise-backend}"
tag="$(git rev-parse --short HEAD)"
uri="${account}.dkr.ecr.${region}.amazonaws.com/${repo}"
aws ecr get-login-password --region "$region" | docker login --username AWS --password-stdin "${account}.dkr.ecr.${region}.amazonaws.com"
docker build --platform linux/arm64 -t "${uri}:${tag}" "$(dirname "$0")/../unirise-api"
docker push "${uri}:${tag}"
echo "pushed ${uri}:${tag}"
