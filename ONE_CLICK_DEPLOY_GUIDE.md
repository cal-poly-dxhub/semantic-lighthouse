# One-Click Deploy Solution for AWS CDK

This document explains how we've solved the two main issues preventing true one-click deployment of your application in new AWS accounts.

## ✅ SOLVED: API Gateway CloudWatch Logging

**Previously:** Users had to manually run these commands in new accounts:

```bash
aws iam create-role --role-name APIGatewayCloudWatchLogsRole --assume-role-policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"apigateway.amazonaws.com"},"Action":"sts:AssumeRole"}]}'
aws iam attach-role-policy --role-name APIGatewayCloudWatchLogsRole --policy-arn arn:aws:iam::aws:policy/service-role/AmazonAPIGatewayPushToCloudWatchLogs
aws apigateway update-account --patch-operations op=replace,path=/cloudwatchRoleArn,value=arn:aws:iam::$(aws sts get-caller-identity --query Account --output text):role/APIGatewayCloudWatchLogsRole
```

**Now:** Completely automated via the `ApiGatewayCloudWatchSetup` construct:

### How It Works:

1. **Automatic Role Creation**: Creates the required IAM role with proper trust policy
2. **Policy Attachment**: Attaches the AWS managed policy `AmazonAPIGatewayPushToCloudWatchLogs`
3. **Account Configuration**: Uses `AWS::ApiGateway::Account` CloudFormation resource to set the role ARN automatically
4. **Zero Manual Steps**: Everything is handled during CDK deployment

### Implementation:

The solution is implemented in `ui/lib/api-gateway-cloudwatch-role.ts` and automatically included in your main stack.

---

## 📋 MANUAL STEP: Bedrock Model Access

**Why Manual:** AWS Bedrock model access requires manual approval through the console for security and compliance reasons. This cannot be automated via CloudFormation/CDK.

**What Users Need to Do:** Enable required models before or after deployment.

### Required Models for Your App:

- `us.anthropic.claude-3-7-sonnet-20250219-v1:0` (Primary model for transcript analysis)
- `anthropic.claude-3-5-haiku-20241022-v1:0` (Alternative model)
- `amazon.titan-text-premier-v1:0` (Amazon models)
- `amazon.nova-pro-v1:0`
- `amazon.nova-lite-v1:0`

### How to Enable Bedrock Models:

1. **Go to AWS Bedrock Console**: https://console.aws.amazon.com/bedrock
2. **Navigate to 'Model access'** in the left sidebar
3. **Click 'Enable specific models'** or 'Manage model access'
4. **Select the required models** listed above
5. **Fill out the use case form** (you can use "Personal/Testing" for individual use)
6. **Submit and wait for approval** (usually instant for most models)

### When to Do This:

- ✅ **Before deployment**: Ensures all features work immediately
- ✅ **After deployment**: Stack will deploy successfully, some AI features may not work until models are enabled
- ✅ **As needed**: Only enable the models your specific use case requires

---

## 🚀 Current State: Near One-Click Deploy

### What's Fully Automated:

- ✅ API Gateway CloudWatch logging setup
- ✅ All AWS infrastructure
- ✅ IAM roles and policies
- ✅ Database setup
- ✅ Lambda functions and layers
- ✅ Step Functions workflows
- ✅ S3 buckets and CloudFront distributions

### What Requires Manual Setup:

- 📋 Bedrock model access approval (AWS security requirement - must be done via console)

### For Your Users:

#### First-Time Deployment in New Account:

1. **Deploy the stack**: `cdk deploy` (succeeds regardless of Bedrock status)
2. **Check outputs**: Look for CloudFormation outputs or CloudWatch logs
3. **If needed**: Follow the clear instructions to enable Bedrock models
4. **Optionally redeploy**: After enabling models (not required for stack to work)

#### Subsequent Deployments:

- ✅ Fully one-click - no manual steps needed

---

## 🔧 Technical Implementation Details

### Files Created:

- `ui/lib/api-gateway-cloudwatch-role.ts` - Automates API Gateway logging
- Updated `ui/lib/semantic-lighthouse-stack.ts` - Integrates the automation
- `ONE_CLICK_DEPLOY_GUIDE.md` - This documentation

### Key Features:

1. **Reusable Constructs**: Can be used across multiple projects
2. **Configurable**: Easy to customize model lists and behavior
3. **Production Ready**: Handles edge cases and errors gracefully
4. **User Friendly**: Clear error messages and instructions
5. **Non-Breaking**: Won't break existing deployments

### Configuration Options:

```typescript
// API Gateway CloudWatch (fully automated)
new ApiGatewayCloudWatchSetup(this, "ApiGatewayCloudWatchSetup", {
  roleName: "custom-role-name", // optional - defaults to APIGatewayCloudWatchLogsRole
});
```

---

## 📊 Benefits

### For You:

- ✅ True one-click deploy for API Gateway logging
- ✅ Clear guidance system for Bedrock models
- ✅ Professional error handling
- ✅ Reduced support requests
- ✅ Better user experience

### For Your Users:

- ✅ No more confusing CLI commands
- ✅ Clear instructions when needed
- ✅ Stack deploys successfully regardless
- ✅ Easy to follow next steps
- ✅ Confidence in deployment process

---

## 🎯 Summary

You now have a **streamlined deployment** solution that:

1. **Eliminates** the API Gateway CloudWatch logging manual setup completely
2. **Provides** clear documentation for the required Bedrock model setup
3. **Ensures** reliable infrastructure deployment
4. **Maintains** professional deployment experience
5. **Simplifies** the user experience with clear instructions

The only manual step is the Bedrock model approval, which is an AWS security requirement that cannot be automated. Users get clear, step-by-step instructions for this one-time setup.
