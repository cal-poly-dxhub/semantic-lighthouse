import { createUser } from "@/src/shared/user";
import {
  CognitoIdentityProviderClient,
  ListUsersCommand,
  UpdateUserPoolCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import { PostConfirmationTriggerEvent } from "aws-lambda";

const ADMIN_GROUP_NAME = process.env.ADMIN_GROUP_NAME!;

const cognitoClient = new CognitoIdentityProviderClient({});

export const handler = async (event: PostConfirmationTriggerEvent) => {
  console.log("INFO: received event:", JSON.stringify(event, null, 2));

  const { userName, userPoolId } = event;
  const userEmail = event.request.userAttributes.email;

  try {
    // create user
    const user = await createUser({
      username: userName,
      email: userEmail,
      groupName: ADMIN_GROUP_NAME,
      createdBy: userName, // created by self
    });

    console.log(
      `INFO: Stored user preferences for ${userName} in DynamoDB: ${JSON.stringify(
        user
      )}`
    );

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

      // disable self-signup
      const updateUserPoolCommand = new UpdateUserPoolCommand({
        UserPoolId: userPoolId,
        AdminCreateUserConfig: { AllowAdminCreateUserOnly: true },
      });
      await cognitoClient.send(updateUserPoolCommand);
      console.log("INFO: Disabled self-signup successfully.");
    } else {
      console.warn(
        `WARN: Not the first user, no admin action needed in Post Confirmation Lambda.`
      );
    }
  } catch (error) {
    console.error("ERROR: Error in Post Confirmation Lambda:", error);
    throw error;
  }

  // return event to complete trigger
  return event;
};
