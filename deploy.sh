#!/bin/bash

# exit on error
set -e

# build frontend
# cd frontend && yarn install && yarn build && cd ..
zip -r frontend.zip frontend/ -x "frontend/node_modules/*" "frontend/.next/*" "frontend/out/*" "frontend/.env" "frontend/next-env.d.ts"

# build lambdas
cd lambda && yarn install && yarn build && cd ..


# deploy stack
JSII_SILENCE_WARNING_UNTESTED_NODE_VERSION=1 UNIQUE_ID=dev-1 npx cdk deploy --profile k12

# cleanup
# cd frontend && rm -r out && cd ..
cd lambda && rm -r dist && cd ..

