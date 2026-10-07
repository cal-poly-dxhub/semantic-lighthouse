#!/bin/bash
# Builds everything and writes the MinuteMaker CloudFormation template to
# ui/template.yaml without deploying. Safe to run on any branch.

set -euo pipefail
cd "$(dirname "$0")"

export COREPACK_ENABLE_DOWNLOAD_PROMPT=0

(cd ui/lambda && corepack yarn install --immutable && corepack yarn build)
(cd ui/frontend && corepack yarn install --frozen-lockfile && corepack yarn build)

cd ui
corepack yarn install --immutable
JSII_SILENCE_WARNING_UNTESTED_NODE_VERSION=1 corepack yarn cdk synth MinuteMaker --path-metadata false --asset-metadata false > template.yaml
echo "Wrote ui/template.yaml"
