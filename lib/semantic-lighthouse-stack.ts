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

    // dynamo table for meetings metadata
    const meetingsTable = new cdk.aws_dynamodb.Table(this, "MeetingsTable", {
      partitionKey: {
        name: "meetingId",
        type: cdk.aws_dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: "createdAt",
        type: cdk.aws_dynamodb.AttributeType.STRING,
      },
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

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
        MEETINGS_BUCKET_NAME: meetingsBucket.bucketName,
        CLOUDFRONT_DOMAIN_NAME: videoDistribution.distributionDomainName,
        MEETINGS_TABLE_NAME: meetingsTable.tableName,
      },
    });

    meetingsTable.grantWriteData(uploadLambda);
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
    const privateVideoAuthResource =
      meetingAuthApi.root.addResource("private-presigned");
    const privateVideoAuthLambda = new cdk.aws_lambda.Function(
      this,
      "PrivateVideoAuthLambda",
      {
        runtime: cdk.aws_lambda.Runtime.NODEJS_LATEST,
        handler: "private-presigned.handler",
        code: cdk.aws_lambda.Code.fromAsset("lambda/dist/video"),
        environment: {
          MEETINGS_BUCKET_NAME: meetingsBucket.bucketName,
          CLOUDFRONT_DOMAIN_NAME: videoDistribution.distributionDomainName,
        },
      }
    );

    meetingsTable.grantWriteData(privateVideoAuthLambda);
    meetingsBucket.grantRead(privateVideoAuthLambda);
    privateVideoAuthResource.addMethod(
      "GET",
      new cdk.aws_apigateway.LambdaIntegration(privateVideoAuthLambda),
      {
        authorizationType: cdk.aws_apigateway.AuthorizationType.COGNITO,
        authorizer,
      }
    );

    // lambda route for generating presigned urls for public videos
    const publicVideoAuthResource =
      meetingAuthApi.root.addResource("public-presigned");
    const publicVideoAuthLambda = new cdk.aws_lambda.Function(
      this,
      "PublicVideoAuthLambda",
      {
        runtime: cdk.aws_lambda.Runtime.NODEJS_LATEST,
        handler: "public-presigned.handler",
        code: cdk.aws_lambda.Code.fromAsset("lambda/dist/video"),
        environment: {
          MEETINGS_BUCKET_NAME: meetingsBucket.bucketName,
          MEETINGS_TABLE_NAME: meetingsTable.tableName,
          CLOUDFRONT_DOMAIN_NAME: videoDistribution.distributionDomainName,
        },
      }
    );

    meetingsTable.grantReadData(publicVideoAuthLambda);
    meetingsBucket.grantRead(publicVideoAuthLambda);
    publicVideoAuthResource.addMethod(
      "GET",
      new cdk.aws_apigateway.LambdaIntegration(publicVideoAuthLambda)
    );

    // lambda for ocr and header extraction
    const processPdfLambda = new cdk.aws_lambda.Function(
      this,
      "ProcessPdfLambda",
      {
        runtime: cdk.aws_lambda.Runtime.NODEJS_LATEST,
        handler: "process-pdf.handler",
        code: cdk.aws_lambda.Code.fromAsset("lambda/dist"),
        environment: {
          MEETINGS_BUCKET_NAME: meetingsBucket.bucketName,
          MEETINGS_TABLE_NAME: meetingsTable.tableName,
        },
      }
    );

    // textract lambda permissions
    processPdfLambda.addToRolePolicy(
      new cdk.aws_iam.PolicyStatement({
        effect: cdk.aws_iam.Effect.ALLOW,
        actions: [
          "textract:StartDocumentAnalysis",
          "textract:GetDocumentAnalysis",
        ],
        resources: ["*"],
      })
    );

    meetingsTable.grantWriteData(uploadLambda);
    meetingsBucket.grantReadWrite(processPdfLambda);

    // s3 trigger
    meetingsBucket.addEventNotification(
      cdk.aws_s3.EventType.OBJECT_CREATED,
      new cdk.aws_s3_notifications.LambdaDestination(processPdfLambda),
      {
        prefix: "", // process all uploads
        suffix: ".pdf", // only process PDF files
      }
    );

    // TODO: textract trigger for processing extracted text

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

    // cloudfront distribution for the frontend bucket
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
          cachePolicy: cdk.aws_cloudfront.CachePolicy.CACHING_DISABLED, // TODO: remove in prod
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

    // TODO: try this

    // bucket for frontend source zip
    // const frontendSource = new cdk.aws_s3.Bucket(this, "FrontendSourceBucket");

    // upload frontend source zip to S3 bucket
    // new cdk.aws_s3_deployment.BucketDeployment(
    //   this,
    //   "FrontendSourceDeployment",
    //   {
    //     sources: [cdk.aws_s3_deployment.Source.asset("./frontend.zip")],
    //     destinationBucket: frontendSource,
    //   }
    // );

    // const frontendBuild = new cdk.aws_codebuild.Project(this, "FrontendBuild", {
    //   // TODO: maybe change to github source so source bucket not needed
    //   source: cdk.aws_codebuild.Source.s3({
    //     bucket: frontendBucket,
    //     path: "frontend.zip",
    //   }),
    //   environment: {
    //     buildImage: cdk.aws_codebuild.LinuxBuildImage.STANDARD_7_0, // latest standard image
    //     privileged: true, // required for docker builds
    //   },
    //   buildSpec: cdk.aws_codebuild.BuildSpec.fromObject({
    //     version: "0.2",
    //     phases: {
    //       install: {
    //         commands: ["echo Installing dependencies...", "yarn install"],
    //       },
    //       build: {
    //         commands: ["echo Building frontend...", "yarn build"],
    //       },
    //     },
    //     artifacts: cdk.aws_codebuild.Artifacts.s3({
    //       bucket: frontendBucket,
    //       includeBuildId: false, // do not include build id in the path
    //       packageZip: false, // do not package as zip
    //       name: "/",
    //     }),
    //     environmentVariables: {
    //       NEXT_PUBLIC_AWS_REGION: {
    //         value: cdk.Aws.REGION,
    //       },
    //       NEXT_PUBLIC_AWS_USER_POOL_ID: {
    //         value: userPool.userPoolId,
    //       },
    //       NEXT_PUBLIC_AWS_USER_POOL_WEB_CLIENT_ID: {
    //         value: userPoolClient.userPoolClientId,
    //       },
    //       NEXT_PUBLIC_DISTRIBUTION_BASE_URL: {
    //         value: `https://${frontendDistribution.distributionDomainName}`,
    //       },
    //       NEXT_PUBLIC_VIDEO_AUTH_API_URL: {
    //         value: videoDistribution.distributionDomainName,
    //       },
    //     },
    //   }),
    // });

    // deploy built frontend assets to S3 bucket
    new cdk.aws_s3_deployment.BucketDeployment(this, "FrontendDeployment", {
      sources: [cdk.aws_s3_deployment.Source.asset("./frontend/out")],
      destinationBucket: frontendBucket,
      distribution: frontendDistribution,
      distributionPaths: ["/*"], // invalidate all files
    });

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
