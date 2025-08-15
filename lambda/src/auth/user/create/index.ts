import { createUserInCognito } from "@/src/shared/cognitoUtils";
import { handleSubscribeToSNS } from "@/src/shared/subscribeToSNS";
import { DynamoDBClient, PutItemCommand } from "@aws-sdk/client-dynamodb";

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
    // create cognito user
    await createUserInCognito(
      username,
      email,
      process.env.USER_POOL_ID!,
      process.env.GROUP_NAME!
    );

    // handle sns subscription
    const { topicArn, topicName } = await handleSubscribeToSNS(username, email);

    // store everything in dynamo
    await dynamoClient.send(
      new PutItemCommand({
        TableName: process.env.TABLE_NAME,
        Item: {
          pk: { S: `USER#${username}` },
          sk: { S: email },
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
