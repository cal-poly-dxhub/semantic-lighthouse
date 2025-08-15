import {
  CreateTopicCommand,
  SNSClient,
  SubscribeCommand,
} from "@aws-sdk/client-sns";

const snsClient = new SNSClient({});

export const handleSubscribeToSNS = async (username: string, email: string) => {
  // create sns topic for user
  const topicName = `semantic-lighthouse-user-${username}`.replace(
    /[^a-zA-Z0-9_-]/g,
    "-"
  );

  const createTopicResponse = await snsClient.send(
    new CreateTopicCommand({
      Name: topicName,
      Attributes: {
        DisplayName: `Semantic Lighthouse Notifications for ${username}`,
      },
    })
  );

  const topicArn = createTopicResponse.TopicArn;

  if (!topicArn) {
    throw new Error(`Failed to create SNS topic for user ${username}`);
  }

  console.log(`INFO: Created SNS topic ${topicArn} for user ${username}`);

  // subscribe user to sns
  await snsClient.send(
    new SubscribeCommand({
      TopicArn: topicArn,
      Protocol: "email",
      Endpoint: email,
    })
  );

  console.log(`INFO: Subscribed ${email} to topic ${topicArn}`);

  return { topicArn, topicName };
};
