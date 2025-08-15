#!/bin/bash

# exit on error
set -e

# deploy stack with unified ID (use v5 to match user's command)
JSII_SILENCE_WARNING_UNTESTED_NODE_VERSION=1 UNIQUE_ID="dev-v2-r1" cdk deploy --profile pubrec