import {
  AdminAddUserToGroupCommand,
  AdminCreateUserCommand,
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
