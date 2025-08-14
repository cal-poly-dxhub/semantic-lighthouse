import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";

export interface DatastoreResourcesProps {
  uniqueId: string;
}

export class DatastoreResources extends Construct {
  public readonly bucket: cdk.aws_s3.Bucket;
  public readonly distribution: cdk.aws_cloudfront.Distribution;
  public readonly table: cdk.aws_dynamodb.Table;

  constructor(scope: Construct, id: string, props: DatastoreResourcesProps) {
    super(scope, id);

    // s3 bucket for meeting data
    this.bucket = new cdk.aws_s3.Bucket(this, "MeetingDataBucket", {
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
                accessControlAllowOrigins: ["*"], // TODO: restrict in production
                accessControlExposeHeaders: ["Access-Control-Allow-Origin"],
                originOverride: true,
              },
            }
          ),
        },
      }
    );

    // single DynamoDB table using composite keys with prefixes
    // Config items: pk="CONFIG#<configId>", sk="CONFIG#<configId>"
    // User items: pk="USER#<userId>", sk="USER#<userId>"
    // Meeting items: pk="MEETING#<meetingId>", sk="MEETING#<createdAt>"
    this.table = new cdk.aws_dynamodb.Table(this, "Table", {
      partitionKey: {
        name: "pk",
        type: cdk.aws_dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: "sk",
        type: cdk.aws_dynamodb.AttributeType.STRING,
      },
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
  }
}
