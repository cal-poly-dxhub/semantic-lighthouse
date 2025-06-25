import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
// import * as sqs from 'aws-cdk-lib/aws-sqs';

export class SemanticLighthouseStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // ------------ AUTH AND ADMIN SETUP ------------

    // TODO: remove
    const uniqueId = "dev-1";

    // cognito

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
    // TODO: cannot log in to default admin user
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

    // lambda

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
        handler: "video/adminPassword.handler",
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

    // ------------ VIDEO AUTH ------------

    // s3 bucket for videos
    const videoBucket = new cdk.aws_s3.Bucket(
      this,
      "SemanticLighthouseVideosBucket",
      {
        bucketName: "semantic-lighthouse-videos",
        removalPolicy: cdk.RemovalPolicy.DESTROY,
        autoDeleteObjects: true,
        publicReadAccess: false,
        encryption: cdk.aws_s3.BucketEncryption.S3_MANAGED,
        blockPublicAccess: cdk.aws_s3.BlockPublicAccess.BLOCK_ACLS_ONLY,
        cors: [
          {
            allowedMethods: [cdk.aws_s3.HttpMethods.GET],
            allowedOrigins: ["*"],
            allowedHeaders: ["*"],
            maxAge: 3000,
          },
        ],
      }
    );

    // TODO: remove
    videoBucket.addToResourcePolicy(
      new cdk.aws_iam.PolicyStatement({
        actions: ["s3:GetObject"],
        resources: [videoBucket.arnForObjects("*")],
        principals: [new cdk.aws_iam.AnyPrincipal()],
      })
    );

    // cloudfront distribution for video bucket
    const videoDistribution = new cdk.aws_cloudfront.Distribution(
      this,
      "SemanticLighthouseVideoDistribution",
      {
        defaultBehavior: {
          origin:
            cdk.aws_cloudfront_origins.S3BucketOrigin.withOriginAccessControl(
              videoBucket
            ),
          viewerProtocolPolicy:
            cdk.aws_cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          allowedMethods: cdk.aws_cloudfront.AllowedMethods.ALLOW_GET_HEAD,
          cachedMethods: cdk.aws_cloudfront.CachedMethods.CACHE_GET_HEAD,
          responseHeadersPolicy: new cdk.aws_cloudfront.ResponseHeadersPolicy(
            this,
            "VideoResponseHeadersPolicy",
            {
              corsBehavior: {
                accessControlAllowCredentials: false,
                accessControlAllowHeaders: ["*"],
                accessControlAllowMethods: ["ALL"],
                accessControlAllowOrigins: ["*"],
                accessControlExposeHeaders: ["Access-Control-Allow-Origin"],
                originOverride: true,
              },
            }
          ),
        },
      }
    );

    // separate api for fetching video presigned urls
    const videoAuthApi = new cdk.aws_apigateway.RestApi(this, "VideoAuthApi", {
      restApiName: "SemanticLighthouseVideoAuthApi",
      description: "API for video authentication",
      deployOptions: {
        stageName: "prod",
        loggingLevel: cdk.aws_apigateway.MethodLoggingLevel.INFO,
        dataTraceEnabled: true,
        metricsEnabled: true,
      },
    });

    const videoAuthResource = videoAuthApi.root.addResource("presigned");

    // lambda for generating presigned urls
    const videoAuthLambda = new cdk.aws_lambda.Function(
      this,
      "VideoAuthLambda",
      {
        runtime: cdk.aws_lambda.Runtime.NODEJS_LATEST,
        handler: "presigned.handler",
        code: cdk.aws_lambda.Code.fromAsset("lambda/dist"),
        environment: {
          VIDEO_BUCKET_NAME: videoBucket.bucketName,
          COGNITO_USER_POOL_ID: userPool.userPoolId,
          COGNITO_APP_CLIENT_ID: userPoolClient.userPoolClientId,
          CLOUDFRONT_DOMAIN_NAME: videoDistribution.distributionDomainName,
        },
      }
    );

    videoBucket.grantRead(videoAuthLambda);
    videoAuthResource.addMethod(
      "GET",
      new cdk.aws_apigateway.LambdaIntegration(videoAuthLambda)
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

    new cdk.CfnOutput(this, "VideoAuthApiEndpoint", {
      value: videoAuthApi.url,
      description: "The endpoint of the Video Auth API",
    });
  }
}
