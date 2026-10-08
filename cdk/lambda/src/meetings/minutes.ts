import { DynamoDBClient, QueryCommand } from "@aws-sdk/client-dynamodb";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";

interface ResponseBody {
  meetingId: string;
  presignedUrl: string;
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token",
  "Access-Control-Allow-Methods": "GET",
  "Content-Type": "application/json",
};

const s3Client = new S3Client({});
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
 * lambda to generate presigned url for minutes.pdf with user ownership verification
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
  const meetingId = event.pathParameters?.meetingId;

  if (!meetingId) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({
        error: "Missing meetingId parameter.",
      }),
    };
  }

  try {
    // =================================================================
    // VERIFY USER OWNS THIS MEETING AND CHECK PROCESSING STATUS
    // =================================================================
    const queryCommand = new QueryCommand({
      TableName: process.env.MEETINGS_TABLE_NAME,
      KeyConditionExpression: "meetingId = :meetingId",
      ExpressionAttributeValues: {
        ":meetingId": { S: meetingId },
      },
      Limit: 1,
    });

    const result = await dynamoClient.send(queryCommand);

    if (!result.Items || result.Items.length === 0) {
      return {
        statusCode: 404,
        headers: corsHeaders,
        body: JSON.stringify({
          error: "Meeting not found.",
        }),
      };
    }

    const meeting = result.Items[0];

    // Check if the user owns this meeting
    if (meeting.userId?.S !== userId) {
      console.warn(
        `WARN: User ${userId} attempted to access meeting ${meetingId} owned by ${meeting.userId?.S}`
      );
      return {
        statusCode: 403,
        headers: corsHeaders,
        body: JSON.stringify({
          error: "Access denied. You can only access your own meetings.",
        }),
      };
    }

    // Check if meeting processing is complete
    if (meeting.status?.S !== "processing-complete") {
      return {
        statusCode: 402,
        headers: corsHeaders,
        body: JSON.stringify({
          error: "Meeting is not processed.",
          details: `Current status: ${meeting.status?.S || "unknown"}`,
        }),
      };
    }

    // =================================================================
    // GENERATE PRESIGNED URL FOR USER'S MEETING MINUTES
    // =================================================================
    const key = `${meetingId}/minutes.pdf`;

    const command = new GetObjectCommand({
      Bucket: process.env.MEETINGS_BUCKET_NAME,
      Key: key,
    });

    const presignedUrl = await getSignedUrl(s3Client, command, {
      expiresIn: 3600, // 1 hour
    });

    console.log(
      `INFO: Generated minutes presigned URL for user ${userId}, meeting ${meetingId}`
    );

    const responseBody: ResponseBody = {
      meetingId,
      presignedUrl,
    };

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify(responseBody),
    };
  } catch (error) {
    console.error("ERROR: Failed to generate presigned URL:", error);
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
