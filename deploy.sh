#!/bin/bash
# Deploys the MinuteMaker stack from a clean, pushed checkout of main, so what's
# live is always a commit anyone can look up.
#
#   AWS_PROFILE=<profile> ./deploy.sh
#
# To deploy another branch on purpose (testing): DEPLOY_BRANCH_OK=1 ./deploy.sh

set -euo pipefail
cd "$(dirname "$0")"

branch=$(git rev-parse --abbrev-ref HEAD)

if [ -n "$(git status --porcelain)" ]; then
  echo "Refusing to deploy: the working tree has uncommitted changes." >&2
  git status --short >&2
  exit 1
fi

git fetch --quiet origin "$branch"
if [ "$(git rev-parse HEAD)" != "$(git rev-parse "origin/$branch")" ]; then
  echo "Refusing to deploy: $branch doesn't match origin/$branch. Push or pull first." >&2
  exit 1
fi

if [ "$branch" != "main" ] && [ "${DEPLOY_BRANCH_OK:-}" != "1" ]; then
  echo "Refusing to deploy from $branch. Deploy from main, or set DEPLOY_BRANCH_OK=1 to deploy this branch on purpose." >&2
  exit 1
fi

account=$(aws sts get-caller-identity --query Account --output text)
echo "Deploying MinuteMaker from $branch ($(git rev-parse --short HEAD)) to AWS account $account"

export COREPACK_ENABLE_DOWNLOAD_PROMPT=0

# compiled Lambdas and the static site are both uploaded by the deploy
(cd ui/lambda && corepack yarn install --immutable && corepack yarn build)
(cd ui/frontend && corepack yarn install --frozen-lockfile && corepack yarn build)

cd ui
corepack yarn install --immutable
JSII_SILENCE_WARNING_UNTESTED_NODE_VERSION=1 corepack yarn cdk deploy MinuteMaker
