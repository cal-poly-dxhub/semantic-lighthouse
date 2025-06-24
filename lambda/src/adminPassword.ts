import * as aws from "aws-sdk";

interface LambdaEvent {
  ResourceProperties: {
    UserPoolId: string;
    Username: string;
    Password: string;
  };
}

/**
 * sets the password for the default admin user for initial login
 * @param event
 * @returns
 */
export const handler = async (event: LambdaEvent) => {
  // log for debug
  console.log("INFO: Received event:", JSON.stringify(event, null, 2));

  const cognitoIdp = new aws.CognitoIdentityServiceProvider();

  try {
    await cognitoIdp
      .adminSetUserPassword({
        UserPoolId: event.ResourceProperties.UserPoolId,
        Username: event.ResourceProperties.Username,
        Password: event.ResourceProperties.Password,
        Permanent: true,
      })
      .promise();
    return {
      status: "Success",
    };
  } catch (error) {
    console.error("Error setting admin password:", error);
    return {
      status: "Error",
      body: JSON.stringify({
        message: "Error setting admin password",
        error: (error as any).message,
      }),
    };
  }
};
