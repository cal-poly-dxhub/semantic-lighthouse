import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";

export interface DataResourcesProps {
  uniqueId: string;
}

export class DataResources extends Construct {
  public readonly bucket: cdk.aws_s3.Bucket;
  public readonly distribution: cdk.aws_cloudfront.Distribution;
  public readonly meetingsTable: cdk.aws_dynamodb.Table;
  public readonly userPreferencesTable: cdk.aws_dynamodb.Table;
  public readonly systemConfigTable: cdk.aws_dynamodb.Table;

  constructor(scope: Construct, id: string, props: DataResourcesProps) {
    super(scope, id);

    const timestamp = Math.floor(Date.now() / 1000)
      .toString()
      .slice(-6);
    const uniquePrefix =
      `semantic-lighthouse-${props.uniqueId}-${timestamp}`.toLowerCase();

    // =================================================================
    // S3 BUCKET - Central storage for all meeting files
    // =================================================================
    this.bucket = new cdk.aws_s3.Bucket(this, "MeetingsBucket", {
      bucketName:
        `${uniquePrefix}-meetings-${cdk.Aws.ACCOUNT_ID}`.toLowerCase(),
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

    // =================================================================
    // CLOUDFRONT DISTRIBUTION - Video CDN for citation URLs
    // =================================================================
    this.distribution = new cdk.aws_cloudfront.Distribution(
      this,
      "VideosDistribution",
      {
        defaultBehavior: {
          origin:
            cdk.aws_cloudfront_origins.S3BucketOrigin.withOriginAccessControl(
              this.bucket
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
                accessControlAllowOrigins: ["*"],
                accessControlExposeHeaders: ["Access-Control-Allow-Origin"],
                originOverride: true,
              },
            }
          ),
        },
      }
    );

    // =================================================================
    // ENHANCED MEETINGS TABLE - With user associations and processing status
    // =================================================================
    this.meetingsTable = new cdk.aws_dynamodb.Table(this, "MeetingsTable", {
      partitionKey: {
        name: "meetingId",
        type: cdk.aws_dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: "createdAt",
        type: cdk.aws_dynamodb.AttributeType.STRING,
      },
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      billingMode: cdk.aws_dynamodb.BillingMode.PAY_PER_REQUEST,
    });

    // Add GSI for querying by userId
    this.meetingsTable.addGlobalSecondaryIndex({
      indexName: "UserMeetingsIndex",
      partitionKey: {
        name: "userId",
        type: cdk.aws_dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: "createdAt",
        type: cdk.aws_dynamodb.AttributeType.STRING,
      },
    });

    // =================================================================
    // USER PREFERENCES TABLE - SNS topic management per user
    // =================================================================
    this.userPreferencesTable = new cdk.aws_dynamodb.Table(
      this,
      "UserPreferencesTable",
      {
        partitionKey: {
          name: "userId",
          type: cdk.aws_dynamodb.AttributeType.STRING,
        },
        removalPolicy: cdk.RemovalPolicy.DESTROY,
        billingMode: cdk.aws_dynamodb.BillingMode.PAY_PER_REQUEST,
      }
    );

    // =================================================================
    // SYSTEM CONFIGURATION TABLE - Hardcoded AI model settings
    // =================================================================
    this.systemConfigTable = new cdk.aws_dynamodb.Table(
      this,
      "SystemConfigTable",
      {
        partitionKey: {
          name: "configKey",
          type: cdk.aws_dynamodb.AttributeType.STRING,
        },
        removalPolicy: cdk.RemovalPolicy.DESTROY,
        billingMode: cdk.aws_dynamodb.BillingMode.PAY_PER_REQUEST,
      }
    );

    // =================================================================
    // PRE-POPULATE SYSTEM CONFIG - Hardcoded AI and processing settings
    // =================================================================
    const populateConfigLambda = new cdk.aws_lambda.Function(
      this,
      "PopulateConfigLambda",
      {
        runtime: cdk.aws_lambda.Runtime.NODEJS_LATEST,
        handler: "index.handler",
        timeout: cdk.Duration.minutes(2),
        code: cdk.aws_lambda.Code.fromInline(`
        const { DynamoDBClient, BatchWriteItemCommand } = require('@aws-sdk/client-dynamodb');
        
        exports.handler = async (event) => {
          console.log('Event:', JSON.stringify(event));
          
          if (event.RequestType === 'Delete') {
            return { PhysicalResourceId: 'populate-system-config' };
          }
          
          const dynamodb = new DynamoDBClient({});
          const tableName = process.env.TABLE_NAME;
          
          const configItems = [
            {
              configKey: 'transcript_model_id',
              configValue: 'us.anthropic.claude-3-7-sonnet-20250219-v1:0',
              description: 'AI model for transcript analysis'
            },
            {
              configKey: 'transcript_max_tokens',
              configValue: '8000',
              description: 'Maximum tokens for transcript analysis'
            },
            {
              configKey: 'transcript_temperature',
              configValue: '0.2',
              description: 'Temperature for transcript analysis'
            },
            {
              configKey: 'agenda_model_id',
              configValue: 'us.anthropic.claude-sonnet-4-20250514-v1:0',
              description: 'AI model for agenda analysis'
            },
            {
              configKey: 'agenda_max_tokens',
              configValue: '65535',
              description: 'Maximum tokens for agenda analysis'
            },
            {
              configKey: 'agenda_temperature',
              configValue: '0.1',
              description: 'Temperature for agenda analysis'
            },
            {
              configKey: 'video_chunk_duration_hours',
              configValue: '4',
              description: 'Video chunk duration in hours'
            },
            {
              configKey: 'presigned_url_expiration_days',
              configValue: '7',
              description: 'Presigned URL expiration in days'
            }
          ];
          
          const putRequests = configItems.map(item => ({
            PutRequest: {
              Item: {
                configKey: { S: item.configKey },
                configValue: { S: item.configValue },
                description: { S: item.description },
                createdAt: { S: new Date().toISOString() }
              }
            }
          }));
          
          try {
            await dynamodb.send(new BatchWriteItemCommand({
              RequestItems: {
                [tableName]: putRequests
              }
            }));
            
            console.log('Successfully populated system configuration');
            return { PhysicalResourceId: 'populate-system-config' };
          } catch (error) {
            console.error('Error populating config:', error);
            throw error;
          }
        };
      `),
        environment: {
          TABLE_NAME: this.systemConfigTable.tableName,
        },
      }
    );

    // Grant permissions to populate config
    this.systemConfigTable.grantWriteData(populateConfigLambda);

    // Custom resource to trigger config population
    new cdk.CustomResource(this, "PopulateSystemConfig", {
      serviceToken: populateConfigLambda.functionArn,
    });

    // =================================================================
    // OUTPUTS
    // =================================================================
    new cdk.CfnOutput(this, "MeetingsBucketName", {
      value: this.bucket.bucketName,
      description: "S3 bucket for meeting files",
    });

    new cdk.CfnOutput(this, "CloudFrontDomain", {
      value: this.distribution.distributionDomainName,
      description: "CloudFront domain for video CDN",
    });

    new cdk.CfnOutput(this, "MeetingsTableName", {
      value: this.meetingsTable.tableName,
      description: "DynamoDB table for meeting metadata",
    });

    new cdk.CfnOutput(this, "UserPreferencesTableName", {
      value: this.userPreferencesTable.tableName,
      description: "DynamoDB table for user preferences",
    });

    new cdk.CfnOutput(this, "SystemConfigTableName", {
      value: this.systemConfigTable.tableName,
      description: "DynamoDB table for system configuration",
    });
  }
}
