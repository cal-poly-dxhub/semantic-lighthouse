import { DynamoDBClient, QueryCommand } from "@aws-sdk/client-dynamodb";
import { S3Client } from "@aws-sdk/client-s3";
import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";

interface Response {
  meetingId: string;
  meetingTitle: string;
  meetingDescription: string;
  meetingDate: string;
  videoVisibility: string;
  status: string;
}

interface ResponseBody {
  data: Response[];
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token",
  "Access-Control-Allow-Methods": "GET",
  "Content-Type": "application/json",
};

const dynamoClient = new DynamoDBClient({});

/**
 * Extract user information from JWT token in Authorization header
 */
function extractUserFromToken(
  event: APIGatewayProxyEvent
): { userId: string; userEmail: string } | null {
  try {
    // Get the authorization header
    const authHeader =
      event.headers.Authorization || event.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      console.error("ERROR: No valid authorization header found");
      return null;
    }

    // Extract JWT token (Bearer <token>)
    const token = authHeader.split(" ")[1];

    // Decode JWT payload (middle section between dots)
    const payload = JSON.parse(
      Buffer.from(token.split(".")[1], "base64").toString()
    );

    const userId = payload["cognito:username"] || payload.sub;
    const userEmail = payload.email;

    if (!userId || !userEmail) {
      console.error(
        "ERROR: Missing userId or userEmail in JWT payload",
        payload
      );
      return null;
    }

    return { userId, userEmail };
  } catch (error) {
    console.error("ERROR: Failed to extract user from token:", error);
    return null;
  }
}

/**
 * lambda to get all meetings for the authenticated user
 * @param event
 */
export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  console.log("INFO: Received event:", JSON.stringify(event, null, 2));

  // Extract user information from JWT token
  const userInfo = extractUserFromToken(event);
  if (!userInfo) {
    return {
      statusCode: 401,
      headers: corsHeaders,
      body: JSON.stringify({
        error: "Unauthorized",
        details: "Valid authentication token required",
      }),
    };
  }

  const { userId } = userInfo;

  try {
    // Query DynamoDB for meetings belonging to this user only
    // Using GSI to query by userId since meetingId is the primary key
    const result = await dynamoClient.send(
      new QueryCommand({
        TableName: process.env.MEETINGS_TABLE_NAME,
        IndexName: "UserMeetingsIndex", // GSI on userId
        KeyConditionExpression: "userId = :userId",
        ExpressionAttributeValues: {
          ":userId": { S: userId },
        },
        ScanIndexForward: false, // Sort by createdAt descending (newest first)
      })
    );

    console.log(
      `INFO: Found ${result.Items?.length || 0} meetings for user ${userId}`
    );

    if (!result.Items || result.Items.length === 0) {
      return {
        statusCode: 200,
        headers: corsHeaders,
        body: JSON.stringify({
          data: [],
          message: "No meetings found for this user.",
        }),
      };
    }

    const responseBody: ResponseBody = {
      data: result.Items.map((item) => ({
        meetingId: item.meetingId?.S || "n/a",
        meetingTitle: item.meetingTitle?.S || "n/a",
        meetingDescription: item.meetingDescription?.S || "n/a",
        meetingDate: item.meetingDate?.S || "n/a",
        videoVisibility: item.videoVisibility?.S || "n/a",
        status: item.status?.S || "n/a",
      })),
    };

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify(responseBody),
    };
  } catch (error) {
    console.error("ERROR: Failed to query meetings:", error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({
        error: "Failed to process request",
        details: error instanceof Error ? error.message : "Unknown error",
      }),
    };
  }
};
