import { createUser } from "@/src/shared/user";

const GROUP_NAME = process.env.GROUP_NAME!;

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
    const newUser = await createUser({
      username,
      email,
      groupName: GROUP_NAME,
      createdBy: event.requestContext.authorizer.claims["cognito:username"],
    });

    console.log(
      `INFO: Stored user preferences for ${username} in DynamoDB: ${JSON.stringify(
        newUser
      )}`
    );

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
