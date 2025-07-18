#!/bin/bash

# exit on error
set -e

# Change to ui directory where CDK project is located
cd ui

# build lambdas
cd lambda && yarn install && yarn build && cd ..

# deploy stack with unified ID (use v5 to match user's command)
JSII_SILENCE_WARNING_UNTESTED_NODE_VERSION=1 UNIQUE_ID="v3" cdk synth --path-metadata false --asset-metadata false > template.yaml

# cleanup
cd lambda && rm -rf dist && cd ..
