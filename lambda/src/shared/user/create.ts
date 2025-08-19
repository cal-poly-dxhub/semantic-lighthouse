import {
  AdminAddUserToGroupCommand,
  AdminCreateUserCommand,
  CognitoIdentityProviderClient,
} from "@aws-sdk/client-cognito-identity-provider";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  CreateTopicCommand,
  SNSClient,
  SubscribeCommand,
} from "@aws-sdk/client-sns";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";
import { User } from "./types";

const TABLE_NAME = process.env.TABLE_NAME!;
const USER_POOL_ID = process.env.USER_POOL_ID!;

const cognitoClient = new CognitoIdentityProviderClient({});
const dynamoClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dynamoClient);
const snsClient = new SNSClient({});

const createCognitoUser = async (
  username: string,
  email: string,
  userPoolId: string,
  groupName: string
) => {
  const createUserCommand = new AdminCreateUserCommand({
    UserPoolId: userPoolId,
    Username: username,
    UserAttributes: [
      {
        Name: "email",
        Value: email,
      },
      {
        Name: "email_verified",
        Value: "true",
      },
    ],
  });

  await cognitoClient.send(createUserCommand);
  console.log(`INFO: User ${email} created successfully`);

  const addUserToGroupCommand = new AdminAddUserToGroupCommand({
    UserPoolId: userPoolId,
    Username: username,
    GroupName: groupName,
  });

  await cognitoClient.send(addUserToGroupCommand);
  console.log(`INFO: User ${email} added to group ${groupName}`);
};

const createDynamoUser = async (
  user: Omit<User, "pk" | "sk" | "updatedAt">
): Promise<User> => {
  const now = new Date().toISOString();
  const newUser: User = {
    pk: `USER#${user.username}`,
    sk: now,
    ...user,
    updatedAt: now,
  };

  await docClient.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: newUser,
    })
  );

  return newUser;
};

const handleSubscribeToSNS = async (username: string, email: string) => {
  // create sns topic for user
  const snsTopicName = `semantic-lighthouse-user-${username}`.replace(
    /[^a-zA-Z0-9_-]/g,
    "-"
  );

  const createTopicResponse = await snsClient.send(
    new CreateTopicCommand({
      Name: snsTopicName,
      Attributes: {
        DisplayName: `Semantic Lighthouse Notifications for ${username}`,
      },
    })
  );

  const snsTopicArn = createTopicResponse.TopicArn;

  if (!snsTopicArn) {
    throw new Error(`Failed to create SNS topic for user ${username}`);
  }

  console.log(`INFO: Created SNS topic ${snsTopicArn} for user ${username}`);

  // subscribe user to sns
  await snsClient.send(
    new SubscribeCommand({
      TopicArn: snsTopicArn,
      Protocol: "email",
      Endpoint: email,
    })
  );

  console.log(`INFO: Subscribed ${email} to topic ${snsTopicArn}`);

  return { snsTopicArn, snsTopicName, emailNotificationsEnabled: true };
};

export const create = async (
  user: Omit<
    User,
    | "pk"
    | "sk"
    | "snsTopicArn"
    | "snsTopicName"
    | "emailNotificationsEnabled"
    | "updatedAt"
  >
) => {
  const { email, username, groupName } = user;

  await createCognitoUser(username, email, USER_POOL_ID, groupName);
  const { snsTopicArn, snsTopicName, emailNotificationsEnabled } =
    await handleSubscribeToSNS(username, email);
  return await createDynamoUser({
    ...user,
    snsTopicArn,
    snsTopicName,
    emailNotificationsEnabled,
  });
};
