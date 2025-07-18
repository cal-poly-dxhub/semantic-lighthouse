import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";

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

    // codebuild project to build frontend from GitHub
    const build = new cdk.aws_codebuild.Project(this, "FrontendBuild", {
      source: cdk.aws_codebuild.Source.gitHub({
        owner: "cal-poly-dxhub",
        repo: "semantic-lighthouse",
        branchOrRef: "main",
        cloneDepth: 1, // shallow clone for faster builds
      }),
      environment: {
        buildImage: cdk.aws_codebuild.LinuxBuildImage.STANDARD_7_0, // Use latest standard image
        computeType: cdk.aws_codebuild.ComputeType.SMALL,
      },
      artifacts: cdk.aws_codebuild.Artifacts.s3({
        bucket: siteBucket,
        includeBuildId: false,
        packageZip: false,
        name: "/",
        encryption: false,
      }),
      environmentVariables: {
        NEXT_PUBLIC_AWS_REGION: {
          value: cdk.Aws.REGION,
        },
        NEXT_PUBLIC_AWS_USER_POOL_ID: {
          value: props.userPool.userPoolId,
        },
        NEXT_PUBLIC_AWS_USER_POOL_WEB_CLIENT_ID: {
          value: props.userPoolClient.userPoolClientId,
        },
        NEXT_PUBLIC_DISTRIBUTION_BASE_URL: {
          value: `https://${this.distribution.distributionDomainName}`,
        },
        NEXT_PUBLIC_MEETING_API_URL: {
          value: props.meetingApi.url,
        },
      },
      buildSpec: cdk.aws_codebuild.BuildSpec.fromObject({
        version: "0.2",
        phases: {
          install: {
            commands: [
              "cd ui/frontend",
              "echo installing dependencies...",
              "yarn install",
            ],
          },
          build: {
            commands: ["echo building...", "yarn build"],
          },
        },
        artifacts: {
          "base-directory": "ui/frontend/out",
          files: ["**/*"],
        },
      }),
      logging: {
        cloudWatch: {
          logGroup: new cdk.aws_logs.LogGroup(this, "FrontendBuildLogGroup", {
            removalPolicy: cdk.RemovalPolicy.DESTROY,
            retention: cdk.aws_logs.RetentionDays.ONE_WEEK,
          }),
        },
      },
    });

    // when codebuild updates, allow invalidation of cloudfront cache
    this.distribution.grant(build.role!, "cloudfront:CreateInvalidation");

    // needs s3 access
    siteBucket.grantWrite(build);

    // ensure the build runs after the source deployment and all env vars are ready
    build.node.addDependency(this.distribution);
    build.node.addDependency(props.userPool);
    build.node.addDependency(props.userPoolClient);
    build.node.addDependency(props.meetingApi);

    // trigger codebuild project on stack creation and update
    const triggerBuild = new cdk.custom_resources.AwsCustomResource(
      this,
      "TriggerCodeBuild",
      {
        onCreate: {
          outputPaths: ["BuildId"],
          service: "CodeBuild",
          action: "startBuild",
          parameters: {
            projectName: build.projectName,
          },
          physicalResourceId: cdk.custom_resources.PhysicalResourceId.of(
            `trigger-codebuild-${Date.now()}`
          ),
        },
        onUpdate: {
          outputPaths: ["BuildId"],
          service: "CodeBuild",
          action: "startBuild",
          parameters: {
            projectName: build.projectName,
          },
          physicalResourceId: cdk.custom_resources.PhysicalResourceId.of(
            `trigger-codebuild-${Date.now()}`
          ),
        },
        policy: cdk.custom_resources.AwsCustomResourcePolicy.fromStatements([
          new cdk.aws_iam.PolicyStatement({
            effect: cdk.aws_iam.Effect.ALLOW,
            actions: ["codebuild:StartBuild"],
            resources: [build.projectArn],
          }),
        ]),
      }
    );

    // trigger build once it is ready
    triggerBuild.node.addDependency(build);
  }
}
