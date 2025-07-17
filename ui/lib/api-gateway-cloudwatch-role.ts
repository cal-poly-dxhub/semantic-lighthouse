import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";

export interface ApiGatewayCloudWatchSetupProps {
  // Optional: specify a custom role name
  roleName?: string;
}

export class ApiGatewayCloudWatchSetup extends Construct {
  public readonly cloudWatchRole: cdk.aws_iam.Role;

  constructor(
    scope: Construct,
    id: string,
    props?: ApiGatewayCloudWatchSetupProps
  ) {
    super(scope, id);

    // Create the CloudWatch logging role for API Gateway
    this.cloudWatchRole = new cdk.aws_iam.Role(
      this,
      "ApiGatewayCloudWatchRole",
      {
        roleName: props?.roleName || "APIGatewayCloudWatchLogsRole",
        assumedBy: new cdk.aws_iam.ServicePrincipal("apigateway.amazonaws.com"),
        description: "Role for API Gateway to push logs to CloudWatch",
        managedPolicies: [
          cdk.aws_iam.ManagedPolicy.fromAwsManagedPolicyName(
            "service-role/AmazonAPIGatewayPushToCloudWatchLogs"
          ),
        ],
      }
    );

    // Set up the API Gateway account configuration
    // This is the crucial step that automates what users had to do manually
    new cdk.aws_apigateway.CfnAccount(this, "ApiGatewayAccount", {
      cloudWatchRoleArn: this.cloudWatchRole.roleArn,
    });

    // Output the role ARN for reference
    new cdk.CfnOutput(this, "CloudWatchRoleArn", {
      value: this.cloudWatchRole.roleArn,
      description: "ARN of the API Gateway CloudWatch logging role",
    });
  }
}
