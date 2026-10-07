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

  constructor(scope: Construct, id: string, props: DataResourcesProps) {
    super(scope, id);

    const timestamp = Math.floor(Date.now() / 1000)
      .toString()
      .slice(-6);

    // Keep bucket name short and compliant with S3 naming rules (max 63 chars, lowercase, no special chars)
    const bucketName = `sl-${props.uniqueId}-${timestamp}`
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "-")
      .slice(0, 50);

    // =================================================================
    // S3 BUCKET - Central storage for all meeting files
    // =================================================================
    this.bucket = new cdk.aws_s3.Bucket(this, "MeetingsBucket", {
      bucketName,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      publicReadAccess: false,
      encryption: cdk.aws_s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: cdk.aws_s3.BlockPublicAccess.BLOCK_ALL,
      eventBridgeEnabled: true, // Enable EventBridge notifications for triggering workflows
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
  }
}
