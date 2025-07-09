import {
  AdminAddUserToGroupCommand,
  CognitoIdentityProviderClient,
  ListUsersCommand,
  UpdateUserPoolCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import {
  SNSClient,
  CreateTopicCommand,
  SubscribeCommand,
} from "@aws-sdk/client-sns";
import { DynamoDBClient, PutItemCommand } from "@aws-sdk/client-dynamodb";
import { PostConfirmationTriggerEvent } from "aws-lambda";

const cognitoClient = new CognitoIdentityProviderClient({});
const snsClient = new SNSClient({});
const dynamoClient = new DynamoDBClient({});

export const handler = async (event: PostConfirmationTriggerEvent) => {
  console.log("INFO: received event:", JSON.stringify(event, null, 2));

  const { userName, userPoolId } = event;
  const userEmail = event.request.userAttributes.email;

  try {
    // =================================================================
    // 1. CREATE SNS TOPIC FOR THIS USER
    // =================================================================
    const topicName = `semantic-lighthouse-user-${userName}`.replace(
      /[^a-zA-Z0-9_-]/g,
      "-"
    );

    const createTopicResponse = await snsClient.send(
      new CreateTopicCommand({
        Name: topicName,
        Attributes: {
          DisplayName: `Semantic Lighthouse Notifications for ${userName}`,
          Description: `Meeting minutes notifications for user ${userName}`,
        },
      })
    );

    const topicArn = createTopicResponse.TopicArn;
    console.log(`INFO: Created SNS topic ${topicArn} for user ${userName}`);

    // =================================================================
    // 2. SUBSCRIBE USER EMAIL TO THEIR SNS TOPIC
    // =================================================================
    await snsClient.send(
      new SubscribeCommand({
        TopicArn: topicArn,
        Protocol: "email",
        Endpoint: userEmail,
      })
    );

    console.log(`INFO: Subscribed ${userEmail} to topic ${topicArn}`);

    // =================================================================
    // 3. STORE USER PREFERENCES IN DYNAMODB
    // =================================================================
    await dynamoClient.send(
      new PutItemCommand({
        TableName: process.env.USER_PREFERENCES_TABLE_NAME,
        Item: {
          userId: { S: userName },
          userEmail: { S: userEmail },
          snsTopicArn: { S: topicArn },
          snsTopicName: { S: topicName },
          emailNotificationsEnabled: { BOOL: true },
          createdAt: { S: new Date().toISOString() },
          updatedAt: { S: new Date().toISOString() },
        },
      })
    );

    console.log(`INFO: Stored user preferences for ${userName} in DynamoDB`);

    // =================================================================
    // 4. EXISTING ADMIN LOGIC (FIRST USER SETUP)
    // =================================================================
    // get > 1 user from user pool
    const listUsersCommand = new ListUsersCommand({
      UserPoolId: userPoolId,
      Limit: 2,
    });
    const { Users } = await cognitoClient.send(listUsersCommand);

    console.log(
      `INFO: Found ${
        Users ? Users.length : 0
      } users in User Pool: ${userPoolId}`
    );

    if (Users && Users.length === 1) {
      console.log(
        `INFO: only one user detected ${userName}. Adding to Admins group.`
      );

      // add to admin group
      const adminAddUserToGroupCommand = new AdminAddUserToGroupCommand({
        UserPoolId: userPoolId,
        Username: userName,
        GroupName: process.env.ADMIN_GROUP_NAME,
      });
      await cognitoClient.send(adminAddUserToGroupCommand);
      console.log(`INFO: User ${userName} added to Admins group.`);

      // disable self-signup
      const updateUserPoolCommand = new UpdateUserPoolCommand({
        UserPoolId: userPoolId,
        AdminCreateUserConfig: { AllowAdminCreateUserOnly: true },
      });
      await cognitoClient.send(updateUserPoolCommand);
      console.log("INFO: Disabled self-signup successfully.");
    } else {
      console.warn(
        `WARN: Not the first user, no admin action needed in Post-Confirmation Lambda.`
      );
    }
  } catch (error) {
    console.error("ERROR: Error in Post-Confirmation Lambda:", error);
    throw error;
  }

  // return event to complete trigger
  return event;
};
