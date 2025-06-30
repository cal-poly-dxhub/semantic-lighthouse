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

    const { uniqueId } = props;

    // cannot get dynamically from group creation - circular dependency
    const adminGroupName = `SemanticLighthouseAdminsGroup-${uniqueId}`;

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

    // ------------ VIDEO AUTH ------------

    // s3 bucket for meetings
    const meetingsBucket = new cdk.aws_s3.Bucket(this, "MeetingsBucket", {
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
    const textractPdfLambda = new cdk.aws_lambda.Function(
      this,
      "TextractPdfLambda",
      {
        runtime: cdk.aws_lambda.Runtime.NODEJS_LATEST,
        handler: "textract-pdf.handler",
        code: cdk.aws_lambda.Code.fromAsset("lambda/dist"),
      }
    );

    // textract lambda permissions
    textractPdfLambda.addToRolePolicy(
      new cdk.aws_iam.PolicyStatement({
        effect: cdk.aws_iam.Effect.ALLOW,
        actions: [
          "textract:StartDocumentAnalysis",
          "textract:GetDocumentAnalysis",
        ],
        resources: ["*"],
      })
    );

    meetingsBucket.grantReadWrite(textractPdfLambda);

    // s3 trigger
    meetingsBucket.addEventNotification(
      cdk.aws_s3.EventType.OBJECT_CREATED,
      new cdk.aws_s3_notifications.LambdaDestination(textractPdfLambda),
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
              meetingsBucket
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

    // separate api for fetching video presigned urls
    const meetingAuthApi = new cdk.aws_apigateway.RestApi(
      this,
      "MeetingAuthApi",
      {
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
      }
    );

    const authorizer = new cdk.aws_apigateway.CognitoUserPoolsAuthorizer(
      this,
      "CognitoAuthorizer",
      {
        cognitoUserPools: [userPool],
      }
    );

    const uploadResource = meetingAuthApi.root.addResource("upload");
    const uploadLambda = new cdk.aws_lambda.Function(this, "UploadLambda", {
      runtime: cdk.aws_lambda.Runtime.NODEJS_LATEST,
      handler: "upload.handler",
      code: cdk.aws_lambda.Code.fromAsset("lambda/dist"),
      environment: {
        MEETING_BUCKET_NAME: meetingsBucket.bucketName,
        CLOUDFRONT_DOMAIN_NAME: videoDistribution.distributionDomainName,
      },
    });

    meetingsBucket.grantReadWrite(uploadLambda);
    uploadResource.addMethod(
      "POST",
      new cdk.aws_apigateway.LambdaIntegration(uploadLambda),
      {
        authorizationType: cdk.aws_apigateway.AuthorizationType.COGNITO,
        authorizer,
      }
    );

    // lambda route for generating presigned urls for private videos
    const videoAuthResource =
      meetingAuthApi.root.addResource("private-presigned");
    const videoAuthLambdaPrivateVideo = new cdk.aws_lambda.Function(
      this,
      "VideoAuthLambdaPrivateVideo",
      {
        runtime: cdk.aws_lambda.Runtime.NODEJS_LATEST,
        handler: "private-presigned.handler",
        code: cdk.aws_lambda.Code.fromAsset("lambda/dist/video"),
        environment: {
          MEETING_BUCKET_NAME: meetingsBucket.bucketName,
          CLOUDFRONT_DOMAIN_NAME: videoDistribution.distributionDomainName,
        },
      }
    );

    meetingsBucket.grantRead(videoAuthLambdaPrivateVideo);
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

    // origin access control for the frontend bucket
    const originAccessControl = new cdk.aws_cloudfront.S3OriginAccessControl(
      this,
      "FrontendOAC",
      {
        description: "OAC for frontend bucket",
      }
    );

    const frontendDistribution = new cdk.aws_cloudfront.Distribution(
      this,
      "FrontendDistribution",
      {
        defaultBehavior: {
          origin:
            cdk.aws_cloudfront_origins.S3BucketOrigin.withOriginAccessControl(
              frontendBucket,
              {
                originAccessControl,
              }
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

    // grant cloudfront access to the S3 bucket
    frontendBucket.addToResourcePolicy(
      new cdk.aws_iam.PolicyStatement({
        effect: cdk.aws_iam.Effect.ALLOW,
        principals: [
          new cdk.aws_iam.ServicePrincipal("cloudfront.amazonaws.com"),
        ],
        actions: ["s3:GetObject"],
        resources: [frontendBucket.arnForObjects("*")],
        conditions: {
          StringEquals: {
            "AWS:SourceArn": `arn:aws:cloudfront::${this.account}:distribution/${frontendDistribution.distributionId}`,
          },
        },
      })
    );

    // TODO: deploy time build and upload frontend assets to S3 bucket
    // do as much in lambda custom resource as possible so minimal requirements for deployer

    // ------------ OUTPUTS ------------

    new cdk.CfnOutput(this, "UserPoolId", {
      value: userPool.userPoolId,
      description: "The ID of the Cognito User Pool",
    });

    new cdk.CfnOutput(this, "UserPoolClientId", {
      value: userPoolClient.userPoolClientId,
      description: "The ID of the Cognito User Pool Client",
    });

    new cdk.CfnOutput(this, "VideoDistributionDomain", {
      value: videoDistribution.distributionDomainName,
      description: "Domain name of the CloudFront distribution for videos",
    });

    new cdk.CfnOutput(this, "MeetingsAuthApiUrl", {
      value: meetingAuthApi.url,
      description: "URL of the Meeting Authentication API",
    });

    new cdk.CfnOutput(this, "FrontendDistributionUrl", {
      value: `https://${frontendDistribution.distributionDomainName}`,
      description: "URL of the deployed frontend application",
    });
  }
}
