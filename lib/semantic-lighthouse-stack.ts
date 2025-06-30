import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import { SemanticLighthouseStackProps } from "../bin/semantic-lighthouse";

export class SemanticLighthouseStack extends cdk.Stack {
  constructor(
    scope: Construct,
    id: string,
    props: SemanticLighthouseStackProps
  ) {
    super(scope, id, props);

    // TODO: rename bucket to: semantic-lighthouse-meetings

    // TODO: lambda 1: agenda ORC + extract headers

    // TODO:
    // build and upload frontend assets to S3 bucket
    // see if things are working

    const { uniqueId } = props;

    // cannot get dynamically from group creation - circular dependency
    const adminGroupName = "AdminsGroup";

    // TODO: change all .DESTROY to .RETAIN in production

    // ------------ AUTH AND ADMIN SETUP ------------

    // cognito

    const userPool = new cdk.aws_cognito.UserPool(this, "UserPool", {
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

    const adminGroup = userPool.addGroup("AdminsGroup", {
      groupName: adminGroupName,
      description: "Administrators group",
      precedence: 1,
    });

    const usersGroup = userPool.addGroup("UsersGroup", {
      groupName: "UsersGroup",
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
        environment: {
          ADMIN_GROUP_NAME: adminGroupName,
        },
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
    const videoBucket = new cdk.aws_s3.Bucket(this, "VideosBucket", {
      bucketName: `semantic-lighthouse-videos-${uniqueId}`,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      publicReadAccess: false,
      encryption: cdk.aws_s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: cdk.aws_s3.BlockPublicAccess.BLOCK_ALL,
      cors: [
        {
          allowedMethods: [
            cdk.aws_s3.HttpMethods.GET,
            cdk.aws_s3.HttpMethods.PUT,
            cdk.aws_s3.HttpMethods.POST,
          ],
          allowedOrigins: ["*"],
          allowedHeaders: ["*"],
          maxAge: 3000,
        },
      ],
    });

    // lambda to extract audio from video
    const videoProcessingLambda = new cdk.aws_lambda.Function(
      this,
      "VideoProcessingLambda",
      {
        runtime: cdk.aws_lambda.Runtime.NODEJS_LATEST,
        handler: "video-processor.handler",
        code: cdk.aws_lambda.Code.fromAsset("lambda/dist/processing"),
      }
    );

    // textract lambda permissions
    videoProcessingLambda.addToRolePolicy(
      new cdk.aws_iam.PolicyStatement({
        effect: cdk.aws_iam.Effect.ALLOW,
        actions: [
          "textract:StartDocumentAnalysis",
          "textract:GetDocumentAnalysis",
        ],
        resources: ["*"],
      })
    );

    videoBucket.grantReadWrite(videoProcessingLambda);

    // s3 trigger
    videoBucket.addEventNotification(
      cdk.aws_s3.EventType.OBJECT_CREATED,
      new cdk.aws_s3_notifications.LambdaDestination(videoProcessingLambda),
      {
        prefix: "", // process all uploads
        suffix: ".pdf", // only process PDF files
      }
    );

    // cloudfront distribution for video bucket
    const videoDistribution = new cdk.aws_cloudfront.Distribution(
      this,
      "VideosDistribution",
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
                accessControlAllowMethods: ["GET", "HEAD", "OPTIONS"],
                accessControlAllowOrigins: ["*"], // TODO: restrict in production
                accessControlExposeHeaders: ["Access-Control-Allow-Origin"],
                originOverride: true,
              },
            }
          ),
        },
      }
    );

    // TODO: add dynamo table

    // TODO: add video upload lambda

    // separate api for fetching video presigned urls
    const videoAuthApi = new cdk.aws_apigateway.RestApi(this, "VideoAuthApi", {
      description: "API for video authentication",
      deployOptions: {
        stageName: "prod",
        loggingLevel: cdk.aws_apigateway.MethodLoggingLevel.INFO,
        dataTraceEnabled: true,
        metricsEnabled: true,
      },
      defaultCorsPreflightOptions: {
        // TODO: restrict in production
        allowOrigins: cdk.aws_apigateway.Cors.ALL_ORIGINS,
        allowMethods: cdk.aws_apigateway.Cors.ALL_METHODS,
      },
    });

    const authorizer = new cdk.aws_apigateway.CognitoUserPoolsAuthorizer(
      this,
      "CognitoAuthorizer",
      {
        cognitoUserPools: [userPool],
      }
    );

    const uploadResource = videoAuthApi.root.addResource("upload");
    const videoUploadLambda = new cdk.aws_lambda.Function(
      this,
      "VideoUploadLambda",
      {
        runtime: cdk.aws_lambda.Runtime.NODEJS_LATEST,
        handler: "upload.handler",
        code: cdk.aws_lambda.Code.fromAsset("lambda/dist/video"),
        environment: {
          VIDEO_BUCKET_NAME: videoBucket.bucketName,
          CLOUDFRONT_DOMAIN_NAME: videoDistribution.distributionDomainName,
        },
      }
    );

    videoBucket.grantReadWrite(videoUploadLambda);
    uploadResource.addMethod(
      "POST",
      new cdk.aws_apigateway.LambdaIntegration(videoUploadLambda),
      {
        authorizationType: cdk.aws_apigateway.AuthorizationType.COGNITO,
        authorizer,
      }
    );

    // lambda route for generating presigned urls for private videos
    const videoAuthResource =
      videoAuthApi.root.addResource("private-presigned");
    const videoAuthLambdaPrivateVideo = new cdk.aws_lambda.Function(
      this,
      "VideoAuthLambdaPrivateVideo",
      {
        runtime: cdk.aws_lambda.Runtime.NODEJS_LATEST,
        handler: "private-presigned.handler",
        code: cdk.aws_lambda.Code.fromAsset("lambda/dist/video"),
        environment: {
          VIDEO_BUCKET_NAME: videoBucket.bucketName,
          CLOUDFRONT_DOMAIN_NAME: videoDistribution.distributionDomainName,
        },
      }
    );

    videoBucket.grantRead(videoAuthLambdaPrivateVideo);
    videoAuthResource.addMethod(
      "GET",
      new cdk.aws_apigateway.LambdaIntegration(videoAuthLambdaPrivateVideo),
      {
        authorizationType: cdk.aws_apigateway.AuthorizationType.COGNITO,
        authorizer,
      }
    );

    // TODO: add public video route

    // ------------ FRONTEND HOSTING ------------

    const frontendBucket = new cdk.aws_s3.Bucket(this, "FrontendBucket", {
      bucketName: `semantic-lighthouse-frontend-${uniqueId}`,
      publicReadAccess: false,
      blockPublicAccess: cdk.aws_s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    const rewriteFunction = new cdk.aws_cloudfront.Function(
      this,
      "RewriteFunction",
      {
        code: cdk.aws_cloudfront.FunctionCode.fromFile({
          filePath: "lambda/dist/frontend-rewrite.js",
        }),
      }
    );

    const frontendDistribution = new cdk.aws_cloudfront.Distribution(
      this,
      "FrontendDistribution",
      {
        defaultBehavior: {
          origin:
            cdk.aws_cloudfront_origins.S3BucketOrigin.withOriginAccessControl(
              frontendBucket
            ),
          functionAssociations: [
            {
              function: rewriteFunction,
              eventType: cdk.aws_cloudfront.FunctionEventType.VIEWER_REQUEST,
            },
          ],
          viewerProtocolPolicy:
            cdk.aws_cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        },
        defaultRootObject: "index.html",
      }
    );

    // TODO: build and upload frontend assets to S3 bucket
    // do as much in lambda custom resource as possible so minimal requirements for deployer

    // ------------ OUTPUTS ------------

    new cdk.CfnOutput(this, "FrontendDistributionUrl", {
      value: `https://${frontendDistribution.distributionDomainName}`,
      description: "URL of the deployed frontend application",
    });
  }
}
