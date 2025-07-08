import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import { SemanticLighthouseStackProps } from "../bin/semantic-lighthouse";
import { AuthResources } from "./auth";
import { CustomEmailResources } from "./custom-email";
import { FrontendResources } from "./frontend";
import { MeetingApiResources } from "./meeting-api";
import { MeetingDataResources } from "./meeting-data";

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

    // ------------ OUTPUTS ------------

    new cdk.CfnOutput(this, "FrontendDistributionUrl", {
      value: `https://${frontendResources.distribution.distributionDomainName}`,
      description: "URL of the deployed frontend application",
    });
  }
}
