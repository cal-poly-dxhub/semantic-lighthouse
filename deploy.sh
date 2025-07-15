#!/bin/bash

# exit on error
set -e
cd ui

# install dependencies
yarn install

# required for zip codebuild
zip -r frontend.zip frontend/ -x \
  "frontend/node_modules/*" \
  "frontend/.next/*" \
  "frontend/out/*" \
  "frontend/.env*" \
  "frontend/next-env.d.ts" \
  "frontend/src/**/*.d.ts" \
  "frontend/src/**/*.js" \
  "frontend/**/*.js.map" \
  "frontend/.vscode/*" \
  "frontend/.DS_Store"


# build lambdas
cd lambda && yarn install && yarn build && cd ..


# deploy stack with unified ID (use v5 to match user's command)
JSII_SILENCE_WARNING_UNTESTED_NODE_VERSION=1 UNIQUE_ID="gus-v2" npx cdk deploy --profile k12

# cleanup
cd lambda && rm -rf dist && cd ..
