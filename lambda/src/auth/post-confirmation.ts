import {
  AdminAddUserToGroupCommand,
  CognitoIdentityProviderClient,
  ListUsersCommand,
  UpdateUserPoolCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import { PostConfirmationTriggerEvent } from "aws-lambda";

const cognitoClient = new CognitoIdentityProviderClient({});

export const handler = async (event: PostConfirmationTriggerEvent) => {
  console.log("INFO: received event:", JSON.stringify(event, null, 2));

  const { userName, userPoolId } = event;

  try {
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
        GroupName: "SemanticLighthouseAdminsGroup",
      });
      await cognitoClient.send(adminAddUserToGroupCommand);
      console.log(`INFO: User ${userName} added to Admins group.`);

      // disable self-signup
      const updateUserPoolCommand = new UpdateUserPoolCommand({
        UserPoolId: userPoolId,
        AdminCreateUserConfig: { AllowAdminCreateUserOnly: true },
      });
      await cognitoClient.send(updateUserPoolCommand);
      console.log("INFO: Disabled elf-signup successfully.");
    } else {
      console.warn(
        `WARN: Not the first user, no action needed in Post-Confirmation Lambda.`
      );
    }
  } catch (error) {
    console.error("ERROR: Error in Post-Confirmation Lambda:", error);
    throw error;
  }

  // return event to complete trigger
  return event;
};
