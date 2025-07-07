import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";

export interface MeetingApiStackProps {
  uniqueId: string;
  userPool: cdk.aws_cognito.UserPool;
  meetingsBucket: cdk.aws_s3.Bucket;
  meetingsTable: cdk.aws_dynamodb.Table;
  videoDistribution: cdk.aws_cloudfront.Distribution;
}

export class MeetingApiResources extends Construct {
  public readonly api: cdk.aws_apigateway.RestApi;
  public readonly authorizer: cdk.aws_apigateway.CognitoUserPoolsAuthorizer;

  constructor(scope: Construct, id: string, props: MeetingApiStackProps) {
    super(scope, id);

    // api
    this.api = new cdk.aws_apigateway.RestApi(this, "MeetingAuthApi", {
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

    // route for /:meetingId
    const meetingIdRoute = this.api.root.addResource("{meetingId}");

    // meeting data upload lambda route
    const uploadResource = this.api.root.addResource("upload");
    const uploadLambda = new cdk.aws_lambda.Function(this, "UploadLambda", {
      runtime: cdk.aws_lambda.Runtime.NODEJS_LATEST,
      handler: "upload.handler",
      code: cdk.aws_lambda.Code.fromAsset("lambda/dist"),
      environment: {
        MEETINGS_BUCKET_NAME: props.meetingsBucket.bucketName,
        CLOUDFRONT_DOMAIN_NAME: props.videoDistribution.distributionDomainName,
        MEETINGS_TABLE_NAME: props.meetingsTable.tableName,
      },
      logGroup: new cdk.aws_logs.LogGroup(this, "UploadLambdaLogGroup", {
        removalPolicy: cdk.RemovalPolicy.DESTROY,
        retention: cdk.aws_logs.RetentionDays.ONE_WEEK,
      }),
    });

    props.meetingsTable.grantWriteData(uploadLambda);
    props.meetingsBucket.grantReadWrite(uploadLambda);

    uploadResource.addMethod(
      "POST",
      new cdk.aws_apigateway.LambdaIntegration(uploadLambda),
      {
        authorizationType: cdk.aws_apigateway.AuthorizationType.COGNITO,
        authorizer: this.authorizer,
      }
    );

    // private presigned url lambda route
    const privateVideoAuthResource =
      meetingIdRoute.addResource("private-presigned");
    const privateVideoAuthLambda = new cdk.aws_lambda.Function(
      this,
      "PrivateVideoAuthLambda",
      {
        runtime: cdk.aws_lambda.Runtime.NODEJS_LATEST,
        handler: "private-presigned.handler",
        code: cdk.aws_lambda.Code.fromAsset("lambda/dist/video"),
        environment: {
          MEETINGS_BUCKET_NAME: props.meetingsBucket.bucketName,
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

    props.meetingsTable.grantWriteData(privateVideoAuthLambda);
    props.meetingsBucket.grantRead(privateVideoAuthLambda);
    privateVideoAuthResource.addMethod(
      "GET",
      new cdk.aws_apigateway.LambdaIntegration(privateVideoAuthLambda),
      {
        authorizationType: cdk.aws_apigateway.AuthorizationType.COGNITO,
        authorizer: this.authorizer,
      }
    );

    // public presigned url lambda route
    const publicVideoAuthResource =
      meetingIdRoute.addResource("public-presigned");
    const publicVideoAuthLambda = new cdk.aws_lambda.Function(
      this,
      "PublicVideoAuthLambda",
      {
        runtime: cdk.aws_lambda.Runtime.NODEJS_LATEST,
        handler: "public-presigned.handler",
        code: cdk.aws_lambda.Code.fromAsset("lambda/dist/video"),
        environment: {
          MEETINGS_BUCKET_NAME: props.meetingsBucket.bucketName,
          MEETINGS_TABLE_NAME: props.meetingsTable.tableName,
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

    props.meetingsTable.grantReadData(publicVideoAuthLambda);
    props.meetingsBucket.grantRead(publicVideoAuthLambda);
    publicVideoAuthResource.addMethod(
      "GET",
      new cdk.aws_apigateway.LambdaIntegration(publicVideoAuthLambda)
    );

    // TODO: meeting minutes download presigned url route
    const minutesResource = meetingIdRoute.addResource("minutes");
    const minutesLambda = new cdk.aws_lambda.Function(this, "MinutesLambda", {
      runtime: cdk.aws_lambda.Runtime.NODEJS_LATEST,
      handler: "minutes.handler",
      code: cdk.aws_lambda.Code.fromAsset("lambda/dist/meetings"),
      environment: {
        MEETINGS_BUCKET_NAME: props.meetingsBucket.bucketName,
        CLOUDFRONT_DOMAIN_NAME: props.videoDistribution.distributionDomainName,
      },
      logGroup: new cdk.aws_logs.LogGroup(this, "MinutesLambdaLogGroup", {
        removalPolicy: cdk.RemovalPolicy.DESTROY,
        retention: cdk.aws_logs.RetentionDays.ONE_WEEK,
      }),
    });

    props.meetingsTable.grantReadData(minutesLambda);
    props.meetingsBucket.grantRead(minutesLambda);
    minutesResource.addMethod(
      "GET",
      new cdk.aws_apigateway.LambdaIntegration(minutesLambda)
    );

    // TODO: fetch all meetings route

    const meetingsResource = this.api.root.addResource("meetings");
    const meetingsLambda = new cdk.aws_lambda.Function(this, "MeetingsLambda", {
      runtime: cdk.aws_lambda.Runtime.NODEJS_LATEST,
      handler: "meetings.handler",
      code: cdk.aws_lambda.Code.fromAsset("lambda/dist/meetings"),
      environment: {
        MEETINGS_BUCKET_NAME: props.meetingsBucket.bucketName,
        CLOUDFRONT_DOMAIN_NAME: props.videoDistribution.distributionDomainName,
      },
      logGroup: new cdk.aws_logs.LogGroup(this, "MeetingsLambdaLogGroup", {
        removalPolicy: cdk.RemovalPolicy.DESTROY,
        retention: cdk.aws_logs.RetentionDays.ONE_WEEK,
      }),
    });

    props.meetingsTable.grantReadData(meetingsLambda);
    props.meetingsBucket.grantRead(meetingsLambda);
    meetingsResource.addMethod(
      "GET",
      new cdk.aws_apigateway.LambdaIntegration(meetingsLambda)
    );
  }
}
