import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import { SemanticLighthouseStackProps } from "../bin/semantic-lighthouse";
import { AuthResources } from "./auth";
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

    // TODO: change all .DESTROY to .RETAIN in production

    // ------------ AUTH AND ADMIN SETUP ------------

    const authResources = new AuthResources(this, "Auth", { uniqueId });

    // ------------ MEETING DATA ------------

    const meetingDataResources = new MeetingDataResources(this, "MeetingData", {
      uniqueId,
      userPool: authResources.userPool,
    });

    // ------------ MEETING API ------------

    new MeetingApiResources(this, "MeetingApi", {
      uniqueId,
      userPool: authResources.userPool,
      meetingsBucket: meetingDataResources.bucket,
      meetingsTable: meetingDataResources.table,
      videoDistribution: meetingDataResources.distribution,
    });

    // ------------ FRONTEND HOSTING ------------

    const frontendResources = new FrontendResources(this, "Frontend", {
      userPool: authResources.userPool,
      userPoolClient: authResources.userPoolClient,
      videoDistribution: meetingDataResources.distribution,
    });

    // ------------ OUTPUTS ------------

    new cdk.CfnOutput(this, "FrontendDistributionUrl", {
      value: `https://${frontendResources.distribution.distributionDomainName}`,
      description: "URL of the deployed frontend application",
    });
  }
}
