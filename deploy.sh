#!/bin/bash

# exit on error
set -e

# build lambdas
cd lambda && yarn install && yarn build && cd ..
# dont need to build layers as they are imported by lambda files
# cd resources/layers && yarn install && yarn build && cd ../..

# deploy stack with unified ID (use v5 to match user's command)
JSII_SILENCE_WARNING_UNTESTED_NODE_VERSION=1 UNIQUE_ID="dev-v2-r1" cdk deploy --profile pubrec

# cleanup
cd lambda && rm -rf dist && cd ..
