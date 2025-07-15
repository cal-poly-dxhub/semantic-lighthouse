#!/bin/bash

# exit on error
set -e

# Change to ui directory where CDK project is located
cd ui

echo "📦 Packaging frontend source files..."
# Package frontend source (no build needed - CDK handles deployment)
# Exclude all compiled JS/TS files, build artifacts, and other temporary files
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

echo "🔨 Building Lambda functions..."
# build lambdas
cd lambda && yarn install && yarn build && cd ..

echo "🚀 Deploying unified stack..."
# deploy stack with unified ID (use v5 to match user's command)
JSII_SILENCE_WARNING_UNTESTED_NODE_VERSION=1 UNIQUE_ID="unified-v5" npx cdk deploy --require-approval never

echo "🧹 Cleaning up build artifacts..."
# cleanup
cd lambda && rm -rf dist && cd ..

echo "✅ Deployment complete!"
echo "🌐 Your stack has been deployed as: SemanticLighthouseStack-unified-v5"
