#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { MinuteMakerStack } from "../lib/minute-maker-stack";

export interface MinuteMakerStackProps extends cdk.StackProps {
  uniqueId: string; // unique identifier for the stack, e.g., "dev-1"
}

const uniqueId = process.env.UNIQUE_ID || "dev-v2";

const app = new cdk.App();

new MinuteMakerStack(app, `MinuteMakerStack-${uniqueId}`, {
  uniqueId,
} as MinuteMakerStackProps);
