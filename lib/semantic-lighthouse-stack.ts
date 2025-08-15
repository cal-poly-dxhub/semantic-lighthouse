import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import { SemanticLighthouseStackProps } from "../bin/semantic-lighthouse";
import { ApiResources } from "./api";
import { AuthResources } from "./auth";
import { CustomEmailResources } from "./custom-email";
import { DatastoreResources } from "./datastore";
import { FrontendResources } from "./frontend";

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

    // ------------ datastore resources (s3, dynamo) ------------

    const datastoreResources = new DatastoreResources(
      this,
      "DatastoreResources",
      {
        uniqueId,
      }
    );

    // ------------ AUTH AND ADMIN SETUP WITH SNS INTEGRATION ------------

    const authResources = new AuthResources(this, "AuthResources", {
      uniqueId,
      usersTable: datastoreResources.table,
    });

    // ------------ api ------------

    const apiResources = new ApiResources(this, "ApiResources", {
      uniqueId,
      userPool: authResources.userPool,
      userPoolClient: authResources.userPoolClient,
      meetingsBucket: datastoreResources.bucket,
      table: datastoreResources.table,
      videoDistribution: datastoreResources.distribution,
      defaultUserGroupName: authResources.defaultUserGroupName,
    });

    // ------------ frontend ------------

    const frontendResources = new FrontendResources(this, "FrontendResources", {
      userPool: authResources.userPool,
      userPoolClient: authResources.userPoolClient,
      api: apiResources.api,
    });

    // ------------ custom emails (needs frontend distribution) ------------

    new CustomEmailResources(this, "CustomEmailResources", {
      userPool: authResources.userPool,
      frontendDistribution: frontendResources.distribution,
    });

    // ------------ outputs ------------

    new cdk.CfnOutput(this, "ApiEndpoint", {
      value: apiResources.api.url,
      description: "API Gateway endpoint URL",
    });

    new cdk.CfnOutput(this, "FrontendUrl", {
      value: `https://${frontendResources.distribution.distributionDomainName}`,
      description: "Frontend CloudFront URL",
    });
  }
}
