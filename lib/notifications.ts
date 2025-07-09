import * as cdk from "aws-cdk-lib";
import * as sns from "aws-cdk-lib/aws-sns";
import { Construct } from "constructs";

export interface NotificationsProps {
  uniquePrefix: string;
}

export class NotificationsResources extends Construct {
  public readonly emailNotificationTopic: sns.Topic;

  constructor(scope: Construct, id: string, props: NotificationsProps) {
    super(scope, id);

    const { uniquePrefix } = props;

    this.emailNotificationTopic = new sns.Topic(this, "EmailNotificationTopic", {
      topicName: `${uniquePrefix}-notifications`,
      displayName: "Semantic Lighthouse Meeting Processor Notifications",
    });
  }
}