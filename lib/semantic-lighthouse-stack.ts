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
      selfSignUpEnabled: true,
      autoVerify: { email: true },
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
          // once first user logs in, trigger disables self-signup
          userSrp: true,
        },
      }
    );

    // user groups

    const adminGroup = userPool.addGroup("SemanticLighthouseAdminsGroup", {
      groupName: "SemanticLighthouseAdminsGroup",
      description: "Administrators group",
      precedence: 1,
    });

    const usersGroup = userPool.addGroup("SemanticLighthouseUsersGroup", {
      groupName: "SemanticLighthouseUsersGroup",
      description: "Users group",
      precedence: 2,
    });

    // lambda

    const postConfirmationLambda = new cdk.aws_lambda.Function(
      this,
      "PostConfirmationLambda",
      {
        description: "lambda function handling post-confirmation",
        runtime: cdk.aws_lambda.Runtime.NODEJS_LATEST,
        code: cdk.aws_lambda.Code.fromAsset("lambda/dist/auth"),
        handler: "post-confirmation.handler",
        timeout: cdk.Duration.seconds(30),
      }
    );

    // grant lambda permission to add users to groups and list users in the user pool
    postConfirmationLambda.addToRolePolicy(
      new cdk.aws_iam.PolicyStatement({
        actions: [
          "cognito-idp:AdminAddUserToGroup",
          "cognito-idp:ListUsers",
          "cognito-idp:UpdateUserPool",
        ],
        resources: [
          `arn:aws:cognito-idp:${this.region}:${this.account}:userpool/*`,
        ],
      })
    );

    // trigger to signup first user and disable self-signup
    userPool.addTrigger(
      cdk.aws_cognito.UserPoolOperation.POST_CONFIRMATION,
      postConfirmationLambda
    );

    // outputs

    new cdk.CfnOutput(this, "UserPoolId", {
      value: userPool.userPoolId,
      description: "The ID of the Cognito User Pool",
    });

    new cdk.CfnOutput(this, "UserPoolClientId", {
      value: userPoolClient.userPoolClientId,
      description: "The ID of the Cognito User Pool Client",
    });

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

    new cdk.CfnOutput(this, "VideoAuthApiEndpoint", {
      value: videoAuthApi.url,
      description: "The endpoint of the Video Auth API",
    });
  }
}
