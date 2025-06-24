import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
// import * as sqs from 'aws-cdk-lib/aws-sqs';

export class SemanticLighthouseStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // TODO: remove
    const uniqueId = "dev-1";

    // ------------ COGNITO ------------

    const userPool = new cdk.aws_cognito.UserPool(this, "UserPool", {
      userPoolName: `SemanticLighthouseUserPool-${uniqueId}`,
      signInAliases: {
        email: true,
        username: true,
      },
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const userPoolClient = new cdk.aws_cognito.UserPoolClient(
      this,
      "UserPoolClient",
      {
        userPool,
        userPoolClientName: `SemanticLighthouseUserPoolClient-${uniqueId}`,
        authFlows: {
          adminUserPassword: true,
          userPassword: true,
          custom: true,
          userSrp: true,
        },
      }
    );

    // user groups

    const adminGroup = userPool.addGroup("SemanticLighthouseAdminsGroup", {
      description: "Administrators group",
    });

    const usersGroup = userPool.addGroup("SemanticLighthouseUsersGroup", {
      description: "Users group",
    });

    // default admin user
    const adminUser = new cdk.aws_cognito.CfnUserPoolUser(this, "AdminUser", {
      userPoolId: userPool.userPoolId,
      username: "admin",
    });

    adminUser.addOverride("Properties.UserAttributes", [
      {
        Name: "email",
        Value: "admin@example.com",
      },
      {
        Name: "email_verified",
        Value: "true",
      },
    ]);

    new cdk.aws_cognito.CfnUserPoolUserToGroupAttachment(
      this,
      "SemanticLighthouseAdminUserGroupAttachment",
      {
        userPoolId: userPool.userPoolId,
        username: adminUser.ref,
        groupName: adminGroup.groupName,
      }
    );

    // ------------ LAMBDA ------------

    const lambdaLogGroup = new cdk.aws_logs.LogGroup(
      this,
      "SemanticLighthouseAdminPasswordLambdaLogGroup",
      {
        logGroupName: `/aws/lambda/${adminUser.ref}-set-password`,
        retention: cdk.aws_logs.RetentionDays.ONE_DAY,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      }
    );

    const adminPasswordLambda = new cdk.aws_lambda.Function(
      this,
      "AdminPasswordLambda",
      {
        runtime: cdk.aws_lambda.Runtime.NODEJS_LATEST,
        handler: "adminPassword.handler",
        code: cdk.aws_lambda.Code.fromAsset("lambda/dist"),
        initialPolicy: [
          new cdk.aws_iam.PolicyStatement({
            actions: ["cognito-idp:AdminSetUserPassword"],
            resources: [userPool.userPoolArn],
          }),
        ],
      }
    );

    new cdk.custom_resources.AwsCustomResource(
      this,
      "SemanticLighthouseAdminDefaultPasswordCustomResource",
      {
        onCreate: {
          service: "Lambda",
          action: "invoke",
          parameters: {
            FunctionName: adminPasswordLambda.functionName,
            InvocationType: "Event",
            arguments: [
              {
                ResourceProperties: {
                  UserPoolId: userPool.userPoolId,
                  Username: adminUser.ref,
                  Password: "AdminPassword123!",
                },
              },
            ],
          },
          physicalResourceId: cdk.custom_resources.PhysicalResourceId.of(
            `${adminUser.ref}-set-password`
          ),
        },
        policy: cdk.custom_resources.AwsCustomResourcePolicy.fromStatements([
          new cdk.aws_iam.PolicyStatement({
            actions: ["lambda:InvokeFunction"],
            resources: [adminPasswordLambda.functionArn],
          }),
        ]),
        logGroup: lambdaLogGroup,
      }
    );

    // ------------ OUTPUTS ------------

    // new cdk.CfnOutput(this, "AdminUserId", {
    //   value: adminUser.ref,
    //   description: "The ID of the Cognito Admin User",
    // });

    new cdk.CfnOutput(this, "AdminUserPasswordLambdaArn", {
      value: adminPasswordLambda.functionArn,
      description: "The ARN of the Admin Password Lambda function",
    });
  }
}
