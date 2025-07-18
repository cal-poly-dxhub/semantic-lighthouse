import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import { SemanticLighthouseStackProps } from "../bin/semantic-lighthouse";
import { AuthResources } from "./auth";
import { CustomEmailResources } from "./custom-email";
import { FrontendResources } from "./frontend";
import { MeetingApiResources } from "./meeting-api";
import { DataResources } from "./data-resources";
import { MeetingProcessorIntegration } from "./meeting-processor-integration";
import { ApiGatewayCloudWatchSetup } from "./api-gateway-cloudwatch-role";

export class SemanticLighthouseStack extends cdk.Stack {
  constructor(
    scope: Construct,
    id: string,
    props: SemanticLighthouseStackProps
  ) {
    super(scope, id, props);

    const { uniqueId } = props;

    // TODO:
    // check flow for new user signup and user creation (already removed current user and enabled self signup)
    // integration

    // TODO: change all .DESTROY to .RETAIN in production

    // ------------ ENHANCED DATA RESOURCES (DynamoDB + S3 + CloudFront) ------------

    const dataResources = new DataResources(this, "DataResources", {
      uniqueId,
    });

    // ------------ AUTH AND ADMIN SETUP WITH SNS INTEGRATION ------------

    const authResources = new AuthResources(this, "Auth", {
      uniqueId,
      userPreferencesTable: dataResources.userPreferencesTable,
    });

    // ------------ MEETING API WITH ENHANCED DATA INTEGRATION ------------

    const meetingApi = new MeetingApiResources(this, "MeetingApi", {
      uniqueId,
      userPool: authResources.userPool,
      userPoolClient: authResources.userPoolClient,
      meetingsBucket: dataResources.bucket,
      meetingsTable: dataResources.meetingsTable,
      videoDistribution: dataResources.distribution,
      defaultUserGroupName: authResources.defaultUserGroupName,
      userPreferencesTable: dataResources.userPreferencesTable,
    });

    // ------------ FRONTEND HOSTING ------------

    const frontendResources = new FrontendResources(this, "Frontend", {
      userPool: authResources.userPool,
      userPoolClient: authResources.userPoolClient,
      meetingApi: meetingApi.api,
    });

    // ------------ MEETING PROCESSOR INTEGRATION (Video processing pipeline) ------------

    const meetingProcessorIntegration = new MeetingProcessorIntegration(
      this,
      "MeetingProcessorIntegration",
      {
        uniqueId,
        bucket: dataResources.bucket,
        meetingsTable: dataResources.meetingsTable,
        userPreferencesTable: dataResources.userPreferencesTable,
        systemConfigTable: dataResources.systemConfigTable,
        videoDistribution: dataResources.distribution,
        frontendDistribution: frontendResources.distribution,
      }
    );

    // ------------ ONE-CLICK DEPLOY AUTOMATION ------------

    // Automate API Gateway CloudWatch logging setup
    const apiGatewayCloudWatchSetup = new ApiGatewayCloudWatchSetup(
      this,
      "ApiGatewayCloudWatchSetup",
      {
        roleName: `${uniqueId}-api-gateway-cloudwatch-role`,
      }
    );

    // ------------ CUSTOM EMAIL MESSAGING ------------

    new CustomEmailResources(this, "CustomEmail", {
      userPool: authResources.userPool,
      frontendDistribution: frontendResources.distribution,
    });

    // =================================================================
    // OUTPUTS FOR INTEGRATED STACK
    // =================================================================
    new cdk.CfnOutput(this, "UserPoolId", {
      value: authResources.userPool.userPoolId,
      description: "Cognito User Pool ID",
    });

    new cdk.CfnOutput(this, "UserPoolClientId", {
      value: authResources.userPoolClient.userPoolClientId,
      description: "Cognito User Pool Client ID",
    });

    new cdk.CfnOutput(this, "ApiEndpoint", {
      value: meetingApi.api.url,
      description: "API Gateway endpoint URL",
    });

    new cdk.CfnOutput(this, "FrontendUrl", {
      value: `https://${frontendResources.distribution.distributionDomainName}`,
      description: "Frontend CloudFront URL",
    });

    new cdk.CfnOutput(this, "VideoDistributionUrl", {
      value: `https://${dataResources.distribution.distributionDomainName}`,
      description: "Video CDN CloudFront URL for citation links",
    });

    new cdk.CfnOutput(this, "ProcessingWorkflowArn", {
      value: meetingProcessorIntegration.stateMachine.stateMachineArn,
      description: "Step Functions state machine ARN for meeting processing",
    });

    new cdk.CfnOutput(this, "ApiGatewayCloudWatchRoleArn", {
      value: apiGatewayCloudWatchSetup.cloudWatchRole.roleArn,
      description:
        "API Gateway CloudWatch logging role (automatically configured)",
    });

    // =================================================================
    // S3 EVENT TRIGGERS FOR MEETING PROCESSING
    // =================================================================

    // EventBridge rule for video uploads - triggers Step Functions workflow
    const s3VideoUploadRule = new cdk.aws_events.Rule(
      this,
      "S3VideoUploadRule",
      {
        eventPattern: {
          source: ["aws.s3"],
          detailType: ["Object Created"],
          detail: {
            bucket: {
              name: [dataResources.bucket.bucketName],
            },
            object: {
              key: [{ prefix: "uploads/meeting_recordings/" }],
            },
          },
        },
      }
    );

    // Add Step Functions as target for video uploads
    s3VideoUploadRule.addTarget(
      new cdk.aws_events_targets.SfnStateMachine(
        meetingProcessorIntegration.stateMachine,
        {
          input: cdk.aws_events.RuleTargetInput.fromEventPath("$"),
        }
      )
    );

    // EventBridge rule for agenda uploads - triggers agenda processor
    const s3AgendaUploadRule = new cdk.aws_events.Rule(
      this,
      "S3AgendaUploadRule",
      {
        eventPattern: {
          source: ["aws.s3"],
          detailType: ["Object Created"],
          detail: {
            bucket: {
              name: [dataResources.bucket.bucketName],
            },
            object: {
              key: [{ prefix: "uploads/agenda_documents/" }],
            },
          },
        },
      }
    );

    // Add Agenda Document Processor as target for agenda uploads
    s3AgendaUploadRule.addTarget(
      new cdk.aws_events_targets.LambdaFunction(
        meetingProcessorIntegration.agendaProcessor,
        {
          event: cdk.aws_events.RuleTargetInput.fromEventPath("$"),
        }
      )
    );
  }
}
