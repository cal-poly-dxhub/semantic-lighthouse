import { DynamoDBClient, GetItemCommand } from "@aws-sdk/client-dynamodb";
import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token",
  "Access-Control-Allow-Methods": "GET",
  "Content-Type": "application/json",
};

const dynamoClient = new DynamoDBClient({});

/**
 * GET /users/roster - the board roster the user last entered on the upload form,
 * so the form can prefill it. API Gateway's Cognito authorizer has already
 * verified the token; this only reads the username from it.
 */
export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  const userId =
    event.requestContext?.authorizer?.claims?.["cognito:username"];
  if (!userId) {
    return {
      statusCode: 401,
      headers: corsHeaders,
      body: JSON.stringify({ error: "Unauthorized" }),
    };
  }

  try {
    const result = await dynamoClient.send(
      new GetItemCommand({
        TableName: process.env.USER_PREFERENCES_TABLE_NAME,
        Key: { userId: { S: userId } },
        ProjectionExpression: "boardRoster",
      })
    );
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        boardRoster: result.Item?.boardRoster?.S ?? "",
      }),
    };
  } catch (error) {
    console.error("ERROR: Failed to read board roster:", error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: "Failed to read board roster" }),
    };
  }
};
