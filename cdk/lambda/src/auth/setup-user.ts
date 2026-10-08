import {
  AdminInitiateAuthCommand,
  AdminRespondToAuthChallengeCommand,
  AuthFlowType,
  ChallengeNameType,
  CognitoIdentityProviderClient,
} from "@aws-sdk/client-cognito-identity-provider";

const cognitoClient = new CognitoIdentityProviderClient({});

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token",
  "Access-Control-Allow-Methods": "OPTIONS,POST",
  "Content-Type": "application/json",
};

export const handler = async (event: any) => {
  console.log("INFO: received event:", JSON.stringify(event, null, 2));

  const { email, temporaryPassword, newPassword } = JSON.parse(
    event.body || "{}"
  );

  if (!email || !temporaryPassword || !newPassword) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({
        error: "Email, temporary password, and new password are required",
      }),
    };
  }

  try {
    const initiateAuthCommand = new AdminInitiateAuthCommand({
      UserPoolId: process.env.USER_POOL_ID,
      ClientId: process.env.CLIENT_ID,
      AuthFlow: AuthFlowType.ADMIN_NO_SRP_AUTH,
      AuthParameters: {
        USERNAME: email,
        PASSWORD: temporaryPassword,
      },
    });

    const authResponse = await cognitoClient.send(initiateAuthCommand);

    // check if new password required
    if (
      authResponse.ChallengeName === ChallengeNameType.NEW_PASSWORD_REQUIRED
    ) {
      const challengeCommand = new AdminRespondToAuthChallengeCommand({
        UserPoolId: process.env.USER_POOL_ID,
        ClientId: process.env.CLIENT_ID,
        ChallengeName: ChallengeNameType.NEW_PASSWORD_REQUIRED,
        Session: authResponse.Session,
        ChallengeResponses: {
          USERNAME: email,
          NEW_PASSWORD: newPassword,
        },
      });

      const challengeResponse = await cognitoClient.send(challengeCommand);

      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          message: "Password changed successfully",
          accessToken: challengeResponse.AuthenticationResult?.AccessToken,
          idToken: challengeResponse.AuthenticationResult?.IdToken,
          refreshToken: challengeResponse.AuthenticationResult?.RefreshToken,
        }),
      };
    } else {
      // if change not required
      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          error: "Password change not required or invalid temporary password",
        }),
      };
    }
  } catch (error: any) {
    console.error("ERROR: Error changing password:", error);

    let errorMessage = "Failed to change password";
    if (error.name === "NotAuthorizedException") {
      errorMessage = "Invalid temporary password";
    } else if (error.name === "InvalidPasswordException") {
      errorMessage = "New password does not meet requirements";
    }

    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({ error: errorMessage }),
    };
  }
};
