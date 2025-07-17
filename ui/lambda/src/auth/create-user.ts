import {
  AdminAddUserToGroupCommand,
  AdminCreateUserCommand,
  CognitoIdentityProviderClient,
} from "@aws-sdk/client-cognito-identity-provider";
import {
  SNSClient,
  CreateTopicCommand,
  SubscribeCommand,
} from "@aws-sdk/client-sns";
import { DynamoDBClient, PutItemCommand } from "@aws-sdk/client-dynamodb";

const cognitoClient = new CognitoIdentityProviderClient({});
const snsClient = new SNSClient({});
const dynamoClient = new DynamoDBClient({});

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token",
  "Access-Control-Allow-Methods": "OPTIONS,POST",
  "Content-Type": "application/json",
};

export const handler = async (event: any) => {
  console.log("INFO: received event:", JSON.stringify(event, null, 2));

  const { email, username } = JSON.parse(event.body || "{}");

  if (!email) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ error: "Email is required" }),
    };
  }

  try {
    // create user with temp password - sends user the email
    const createUserCommand = new AdminCreateUserCommand({
      UserPoolId: process.env.USER_POOL_ID,
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

    // add user to group
    const addUserToGroupCommand = new AdminAddUserToGroupCommand({
      UserPoolId: process.env.USER_POOL_ID,
      Username: username,
      GroupName: process.env.GROUP_NAME,
    });

    await cognitoClient.send(addUserToGroupCommand);
    console.log(`INFO: User ${email} added to group ${process.env.GROUP_NAME}`);

    // =================================================================
    // CREATE SNS TOPIC AND USER PREFERENCES FOR ADMIN-CREATED USER
    // =================================================================

    // 1. CREATE SNS TOPIC FOR THIS USER
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

    // 2. SUBSCRIBE USER EMAIL TO THEIR SNS TOPIC
    await snsClient.send(
      new SubscribeCommand({
        TopicArn: topicArn,
        Protocol: "email",
        Endpoint: email,
      })
    );

    console.log(`INFO: Subscribed ${email} to topic ${topicArn}`);

    // 3. STORE USER PREFERENCES IN DYNAMODB
    await dynamoClient.send(
      new PutItemCommand({
        TableName: process.env.USER_PREFERENCES_TABLE_NAME,
        Item: {
          userId: { S: username },
          userEmail: { S: email },
          snsTopicArn: { S: topicArn },
          snsTopicName: { S: topicName },
          emailNotificationsEnabled: { BOOL: true },
          createdAt: { S: new Date().toISOString() },
          updatedAt: { S: new Date().toISOString() },
        },
      })
    );

    console.log(`INFO: Stored user preferences for ${username} in DynamoDB`);

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        message: "User created successfully and invitation sent",
        username: email,
      }),
    };
  } catch (error) {
    console.error("ERROR: Error creating user:", error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: "Failed to create user" }),
    };
  }
};
