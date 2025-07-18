#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { SemanticLighthouseStack } from "../lib/semantic-lighthouse-stack";

export interface SemanticLighthouseStackProps extends cdk.StackProps {
  uniqueId: string; // unique identifier for the stack, e.g., "dev-1"
}

const uniqueId = process.env.UNIQUE_ID || "dev-v1";

const app = new cdk.App();

new SemanticLighthouseStack(app, `SemanticLighthouseStack-${uniqueId}`, {
  uniqueId,
} as SemanticLighthouseStackProps);
