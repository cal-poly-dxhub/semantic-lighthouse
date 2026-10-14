#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { MinuteMakerStack } from "../lib/minute-maker-stack";

const app = new cdk.App();

// One stack per AWS account. CDK generates every resource name inside it, so
// nothing needs a unique ID and a redeploy never renames (and replaces) a resource.
new MinuteMakerStack(app, "MinuteMaker");
