import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as fs from "fs";
import * as path from "path";

export interface FrontendResourcesProps {
  userPool: cdk.aws_cognito.UserPool;
  userPoolClient: cdk.aws_cognito.UserPoolClient;
  meetingApi: cdk.aws_apigateway.RestApi;
}

export class FrontendResources extends Construct {
  public readonly distribution: cdk.aws_cloudfront.Distribution;

  constructor(scope: Construct, id: string, props: FrontendResourcesProps) {
    super(scope, id);

    // s3 bucket for static assets
    const siteBucket = new cdk.aws_s3.Bucket(this, "FrontendBucket", {
      publicReadAccess: false,
      blockPublicAccess: cdk.aws_s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      encryption: cdk.aws_s3.BucketEncryption.S3_MANAGED,
    });

    // cloudfront function to rewrite requests (webapp --> s3 --> cloudfront)
    const rewriteFunction = new cdk.aws_cloudfront.Function(
      this,
      "RewriteFunction",
      {
        code: cdk.aws_cloudfront.FunctionCode.fromFile({
          filePath: "lambda/dist/frontend-rewrite.js",
        }),
      }
    );

    // origin access control
    const originAccessControl = new cdk.aws_cloudfront.S3OriginAccessControl(
      this,
      "FrontendOAC",
      {
        description: "OAC for frontend bucket",
      }
    );

    // cloudfront distribution
    this.distribution = new cdk.aws_cloudfront.Distribution(
      this,
      "FrontendDistribution",
      {
        defaultBehavior: {
          origin:
            cdk.aws_cloudfront_origins.S3BucketOrigin.withOriginAccessControl(
              siteBucket,
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

    // the site is built locally (deploy.sh runs `yarn build` in ui/frontend) and uploaded
    // as-is. values that only exist after deploy go in /config.json, filled in by
    // CloudFormation, and the app reads it at startup.
    const siteDir = path.join(__dirname, "../frontend/out");
    if (!fs.existsSync(path.join(siteDir, "index.html"))) {
      throw new Error(
        `No frontend build at ${siteDir}. Run \`yarn build\` in ui/frontend first (deploy.sh does this).`
      );
    }

    new cdk.aws_s3_deployment.BucketDeployment(this, "DeploySite", {
      sources: [
        cdk.aws_s3_deployment.Source.asset(siteDir),
        cdk.aws_s3_deployment.Source.jsonData("config.json", {
          region: cdk.Stack.of(this).region,
          userPoolId: props.userPool.userPoolId,
          userPoolClientId: props.userPoolClient.userPoolClientId,
          apiUrl: props.meetingApi.url,
        }),
      ],
      destinationBucket: siteBucket,
      distribution: this.distribution,
      distributionPaths: ["/*"],
    });
  }
}
