import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import { SemanticLighthouseStackProps } from "../bin/semantic-lighthouse";
import { AuthResources } from "./auth";
import { CustomEmailResources } from "./custom-email";
import { FrontendResources } from "./frontend";
import { MeetingApiResources } from "./meeting-api";
import { MeetingDataResources } from "./meeting-data";
import { NotificationsResources } from "./notifications";
import { ProcessingFunctionsResources } from "./processing-functions";
import { ProcessingWorkflowResources } from "./processing-workflow";
import { AgendaProcessorResources } from "./agenda-processor";
import { ProcessingEventsResources } from "./processing-events";

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

    // ------------ AUTH AND ADMIN SETUP ------------

    const authResources = new AuthResources(this, "Auth", { uniqueId });

    // ------------ MEETING DATA ------------

    const meetingDataResources = new MeetingDataResources(this, "MeetingData", {
      uniqueId,
      userPool: authResources.userPool,
    });

    // ------------ MEETING API ------------

    const meetingApi = new MeetingApiResources(this, "MeetingApi", {
      uniqueId,
      userPool: authResources.userPool,
      userPoolClient: authResources.userPoolClient,
      meetingsBucket: meetingDataResources.bucket,
      meetingsTable: meetingDataResources.table,
      videoDistribution: meetingDataResources.distribution,
      defaultUserGroupName: authResources.defaultUserGroupName,
    });

    // ------------ FRONTEND HOSTING ------------

    const frontendResources = new FrontendResources(this, "Frontend", {
      userPool: authResources.userPool,
      userPoolClient: authResources.userPoolClient,
      meetingApi: meetingApi.api,
    });

    // ------------ CUSTOM EMAIL SETUP ------------

    new CustomEmailResources(this, "CustomEmail", {
      userPool: authResources.userPool,
      frontendDistribution: frontendResources.distribution,
    });

    // ------------ MEETING PROCESSOR ------------

    const resourcePrefix = "semantic-lighthouse";
    const uniquePrefix = `${resourcePrefix}-${uniqueId}`;

    const notifications = new NotificationsResources(this, "Notifications", {
      uniquePrefix,
    });

    const processingFunctions = new ProcessingFunctionsResources(this, "ProcessingFunctions", {
      uniquePrefix,
      meetingsBucket: meetingDataResources.bucket,
      meetingsTable: meetingDataResources.table,
      emailNotificationTopicArn: notifications.emailNotificationTopic.topicArn,
    });

    const processingWorkflow = new ProcessingWorkflowResources(this, "ProcessingWorkflow", {
      uniquePrefix,
      meetingsBucket: meetingDataResources.bucket,
      processingFunctions: processingFunctions.functions,
    });

    const agendaProcessor = new AgendaProcessorResources(this, "AgendaProcessor", {
      uniquePrefix,
      meetingsBucket: meetingDataResources.bucket,
      stateMachine: processingWorkflow.stateMachine,
    });

    new ProcessingEventsResources(this, "ProcessingEvents", {
      meetingsBucket: meetingDataResources.bucket,
      stateMachine: processingWorkflow.stateMachine,
      agendaDocumentProcessor: agendaProcessor.agendaDocumentProcessor,
    });

    // ------------ OUTPUTS ------------

    new cdk.CfnOutput(this, "FrontendDistributionUrl", {
      value: `https://${frontendResources.distribution.distributionDomainName}`,
      description: "URL of the deployed frontend application",
    });
  }
}
