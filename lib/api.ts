import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";

export interface ApiResourcesProps {
  uniqueId: string;
  userPool: cdk.aws_cognito.UserPool;
  meetingsBucket: cdk.aws_s3.Bucket;
  table: cdk.aws_dynamodb.Table;
  videoDistribution: cdk.aws_cloudfront.Distribution;
  userPoolClient: cdk.aws_cognito.UserPoolClient;
  defaultUserGroupName: string;
}

export class ApiResources extends Construct {
  public readonly api: cdk.aws_apigateway.RestApi;
  public readonly authorizer: cdk.aws_apigateway.CognitoUserPoolsAuthorizer;

  constructor(scope: Construct, id: string, props: ApiResourcesProps) {
    super(scope, id);

    // reference stack
    const stack = cdk.Stack.of(this);

    // api
    this.api = new cdk.aws_apigateway.RestApi(this, "AuthApi", {
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

    this.authorizer = new cdk.aws_apigateway.CognitoUserPoolsAuthorizer(
      this,
      "CognitoAuthorizer",
      {
        cognitoUserPools: [props.userPool],
      }
    );

    // /:meetingId
    const meetingIdRoute = this.api.root.addResource("{meetingId}");

    // /:meetingId/upload
    const uploadResource = this.api.root.addResource("upload");
    const uploadLambda = new cdk.aws_lambda.Function(this, "UploadLambda", {
      runtime: cdk.aws_lambda.Runtime.NODEJS_LATEST,
      handler: "upload.handler",
      code: cdk.aws_lambda.Code.fromAsset("dist/lambda/src"),
      environment: {
        MEETINGS_BUCKET_NAME: props.meetingsBucket.bucketName,
        CLOUDFRONT_DOMAIN_NAME: props.videoDistribution.distributionDomainName,
        TABLE_NAME: props.table.tableName,
      },
      logGroup: new cdk.aws_logs.LogGroup(this, "UploadLambdaLogGroup", {
        removalPolicy: cdk.RemovalPolicy.DESTROY,
        retention: cdk.aws_logs.RetentionDays.ONE_WEEK,
      }),
    });

    props.table.grantWriteData(uploadLambda);
    props.meetingsBucket.grantReadWrite(uploadLambda);

    uploadResource.addMethod(
      "POST",
      new cdk.aws_apigateway.LambdaIntegration(uploadLambda),
      {
        authorizationType: cdk.aws_apigateway.AuthorizationType.COGNITO,
        authorizer: this.authorizer,
      }
    );

    // /:meetingId/private-presigned
    const privateVideoAuthResource =
      meetingIdRoute.addResource("private-presigned");
    const privateVideoAuthLambda = new cdk.aws_lambda.Function(
      this,
      "PrivateVideoAuthLambda",
      {
        runtime: cdk.aws_lambda.Runtime.NODEJS_LATEST,
        handler: "private-presigned.handler",
        code: cdk.aws_lambda.Code.fromAsset("dist/lambda/src/video"),
        environment: {
          MEETINGS_BUCKET_NAME: props.meetingsBucket.bucketName,
          TABLE_NAME: props.table.tableName,
          CLOUDFRONT_DOMAIN_NAME:
            props.videoDistribution.distributionDomainName,
        },
        logGroup: new cdk.aws_logs.LogGroup(
          this,
          "PrivateVideoAuthLambdaLogGroup",
          {
            removalPolicy: cdk.RemovalPolicy.DESTROY,
            retention: cdk.aws_logs.RetentionDays.ONE_WEEK,
          }
        ),
      }
    );

    // Grant DynamoDB read permissions for private video authentication
    props.table.grantReadData(privateVideoAuthLambda);
    props.meetingsBucket.grantRead(privateVideoAuthLambda);
    privateVideoAuthResource.addMethod(
      "GET",
      new cdk.aws_apigateway.LambdaIntegration(privateVideoAuthLambda),
      {
        authorizationType: cdk.aws_apigateway.AuthorizationType.COGNITO,
        authorizer: this.authorizer,
      }
    );

    // /:meetingId/public-presigned
    const publicVideoAuthResource =
      meetingIdRoute.addResource("public-presigned");
    const publicVideoAuthLambda = new cdk.aws_lambda.Function(
      this,
      "PublicVideoAuthLambda",
      {
        runtime: cdk.aws_lambda.Runtime.NODEJS_LATEST,
        handler: "public-presigned.handler",
        code: cdk.aws_lambda.Code.fromAsset("dist/lambda/src/video"),
        environment: {
          MEETINGS_BUCKET_NAME: props.meetingsBucket.bucketName,
          TABLE_NAME: props.table.tableName,
          CLOUDFRONT_DOMAIN_NAME:
            props.videoDistribution.distributionDomainName,
        },
        logGroup: new cdk.aws_logs.LogGroup(
          this,
          "PublicVideoAuthLambdaLogGroup",
          {
            removalPolicy: cdk.RemovalPolicy.DESTROY,
            retention: cdk.aws_logs.RetentionDays.ONE_WEEK,
          }
        ),
      }
    );

    props.table.grantReadData(publicVideoAuthLambda);
    props.meetingsBucket.grantRead(publicVideoAuthLambda);
    publicVideoAuthResource.addMethod(
      "GET",
      new cdk.aws_apigateway.LambdaIntegration(publicVideoAuthLambda)
    );

    // TODO: meeting minutes pdf download presigned url route
    // /:meetingId/minutes
    const minutesResource = meetingIdRoute.addResource("minutes");
    const minutesLambda = new cdk.aws_lambda.Function(this, "MinutesLambda", {
      runtime: cdk.aws_lambda.Runtime.NODEJS_LATEST,
      handler: "minutes.handler",
      code: cdk.aws_lambda.Code.fromAsset("dist/lambda/src/meetings"),
      environment: {
        MEETINGS_BUCKET_NAME: props.meetingsBucket.bucketName,
        CLOUDFRONT_DOMAIN_NAME: props.videoDistribution.distributionDomainName,
      },
      logGroup: new cdk.aws_logs.LogGroup(this, "MinutesLambdaLogGroup", {
        removalPolicy: cdk.RemovalPolicy.DESTROY,
        retention: cdk.aws_logs.RetentionDays.ONE_WEEK,
      }),
    });

    props.table.grantReadData(minutesLambda);
    props.meetingsBucket.grantRead(minutesLambda);
    minutesResource.addMethod(
      "GET",
      new cdk.aws_apigateway.LambdaIntegration(minutesLambda)
    );

    // TODO: fetch all meetings route

    // /all-meetings
    const allMeetingsResource = this.api.root.addResource("all-meetings");
    const allMeetingsLambda = new cdk.aws_lambda.Function(
      this,
      "AllMeetingsLambda",
      {
        runtime: cdk.aws_lambda.Runtime.NODEJS_LATEST,
        handler: "all.handler",
        code: cdk.aws_lambda.Code.fromAsset("dist/lambda/src/meetings"),
        environment: {
          MEETINGS_BUCKET_NAME: props.meetingsBucket.bucketName,
          CLOUDFRONT_DOMAIN_NAME:
            props.videoDistribution.distributionDomainName,
        },
        logGroup: new cdk.aws_logs.LogGroup(this, "AllMeetingsLambdaLogGroup", {
          removalPolicy: cdk.RemovalPolicy.DESTROY,
          retention: cdk.aws_logs.RetentionDays.ONE_WEEK,
        }),
      }
    );

    props.table.grantReadData(allMeetingsLambda);
    props.meetingsBucket.grantRead(allMeetingsLambda);
    allMeetingsResource.addMethod(
      "GET",
      new cdk.aws_apigateway.LambdaIntegration(allMeetingsLambda)
    );

    // /users
    const usersResource = this.api.root.addResource("users");

    // create lambda layer for sns subscription function
    const subSNSLayer = new cdk.aws_lambda.LayerVersion(this, "SubSNSLayer", {
      code: cdk.aws_lambda.Code.fromAsset("dist/resources/layers"),
      compatibleRuntimes: [cdk.aws_lambda.Runtime.NODEJS_LATEST],
    });

    // /users/create
    const createUserResource = usersResource.addResource("create");
    const createUserLambda = new cdk.aws_lambda.Function(
      this,
      "CreateUserLambda",
      {
        runtime: cdk.aws_lambda.Runtime.NODEJS_LATEST,
        handler: "create-user.handler",
        code: cdk.aws_lambda.Code.fromAsset("dist/lambda/src/auth"),
        environment: {
          USER_POOL_ID: props.userPool.userPoolId,
          GROUP_NAME: props.defaultUserGroupName,
          TABLE_NAME: props.table.tableName,
        },
        layers: [subSNSLayer],
        logGroup: new cdk.aws_logs.LogGroup(this, "CreateUserLambdaLogGroup", {
          removalPolicy: cdk.RemovalPolicy.DESTROY,
          retention: cdk.aws_logs.RetentionDays.ONE_WEEK,
        }),
      }
    );

    // grant lambda permission to add users to groups and list users in the user pool
    createUserLambda.addToRolePolicy(
      new cdk.aws_iam.PolicyStatement({
        actions: [
          "cognito-idp:AdminAddUserToGroup",
          "cognito-idp:UpdateUserPool",
        ],
        resources: [
          // string version to avoid circular dependency
          `arn:aws:cognito-idp:${stack.region}:${stack.account}:userpool/*`,
        ],
      })
    );

    // grant lambda permission to create SNS topics and subscribe users
    createUserLambda.addToRolePolicy(
      new cdk.aws_iam.PolicyStatement({
        actions: ["sns:CreateTopic", "sns:Subscribe", "sns:SetTopicAttributes"],
        resources: [
          `arn:aws:sns:${stack.region}:${stack.account}:semantic-lighthouse-user-*`,
        ],
      })
    );

    // grant lambda permission to write to user preferences table
    props.table.grantWriteData(createUserLambda);

    props.userPool.grant(createUserLambda, "cognito-idp:AdminCreateUser");
    createUserResource.addMethod(
      "POST",
      new cdk.aws_apigateway.LambdaIntegration(createUserLambda),
      {
        authorizationType: cdk.aws_apigateway.AuthorizationType.COGNITO,
        authorizer: this.authorizer,
      }
    );

    // /users/setup
    const setupUserResource = usersResource.addResource("setup");
    const setupUserLambda = new cdk.aws_lambda.Function(
      this,
      "SetupUserLambda",
      {
        runtime: cdk.aws_lambda.Runtime.NODEJS_LATEST,
        handler: "setup-user.handler",
        code: cdk.aws_lambda.Code.fromAsset("dist/lambda/src/auth"),
        environment: {
          USER_POOL_ID: props.userPool.userPoolId,
          CLIENT_ID: props.userPoolClient.userPoolClientId,
        },
        layers: [subSNSLayer],
        logGroup: new cdk.aws_logs.LogGroup(this, "SetupUserLambdaLogGroup", {
          removalPolicy: cdk.RemovalPolicy.DESTROY,
          retention: cdk.aws_logs.RetentionDays.ONE_WEEK,
        }),
      }
    );

    props.userPool.grant(
      setupUserLambda,
      "cognito-idp:AdminInitiateAuth",
      "cognito-idp:AdminRespondToAuthChallenge"
    );
    setupUserResource.addMethod(
      "POST",
      new cdk.aws_apigateway.LambdaIntegration(setupUserLambda),
      {
        authorizationType: cdk.aws_apigateway.AuthorizationType.COGNITO,
        authorizer: this.authorizer,
      }
    );
  }
}
