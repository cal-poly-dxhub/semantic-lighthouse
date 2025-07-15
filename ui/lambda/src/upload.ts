import { DynamoDBClient, PutItemCommand } from "@aws-sdk/client-dynamodb";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { randomUUID } from "crypto";

interface ResponseBody {
  meetingId: string;
  videoPresignedUrl: string;
  agendaPresignedUrl: string;
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token",
  "Access-Control-Allow-Methods": "OPTIONS,POST",
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
    // Note: In production, you should verify the JWT signature, but for now we'll just decode
    const payload = JSON.parse(
      Buffer.from(token.split(".")[1], "base64").toString()
    );

    const userId = payload.sub || payload["cognito:username"];
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
 * lambda to generate presigned url for uploading video.mp4 and agenda.pdf
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

  const { userId, userEmail } = userInfo;
  const meetingId = randomUUID();

  const body = JSON.parse(event.body ?? "{}");

  if (
    !body ||
    !body.meetingTitle ||
    !body.meetingDate ||
    !body.videoVisibility ||
    body.meetingDescription.length > 500
  ) {
    console.error("ERROR: Invalid request body:", body);

    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({
        error: "Invalid request body",
        details:
          "Please provide meetingTitle, meetingDate, visibility and a description (max 500 characters).",
      }),
    };
  }

  // Validate customPromptTemplateId if provided
  if (
    body.customPromptTemplateId &&
    typeof body.customPromptTemplateId !== "string"
  ) {
    console.error(
      "ERROR: Invalid customPromptTemplateId:",
      body.customPromptTemplateId
    );
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({
        error: "Invalid request body",
        details: "customPromptTemplateId must be a string if provided.",
      }),
    };
  }

  try {
    const videoKey = `uploads/meeting_recordings/${meetingId}.mp4`;
    const command = new PutObjectCommand({
      Bucket: process.env.MEETINGS_BUCKET_NAME,
      Key: videoKey,
      ContentType: "video/mp4",
    });

    const agendaKey = `uploads/agenda_documents/${meetingId}.pdf`;
    const agendaCommand = new PutObjectCommand({
      Bucket: process.env.MEETINGS_BUCKET_NAME,
      Key: agendaKey,
      ContentType: "application/pdf",
    });

    const videoPresignedUrl = await getSignedUrl(s3Client, command, {
      expiresIn: 3600, // 60 min
    });

    const agendaPresignedUrl = await getSignedUrl(s3Client, agendaCommand, {
      expiresIn: 3600, // 60 min
    });

    // =================================================================
    // STORE MEETING METADATA WITH USER ASSOCIATION IN DYNAMODB
    // =================================================================
    const item: any = {
      // Enhanced schema with user associations
      meetingId: { S: meetingId },
      createdAt: { S: new Date().toISOString() },

      // User association
      userId: { S: userId },
      userEmail: { S: userEmail },

      // Meeting metadata
      meetingTitle: { S: body.meetingTitle },
      meetingDate: { S: body.meetingDate },
      meetingDescription: { S: body.meetingDescription },
      videoVisibility: { S: body.videoVisibility },

      // Processing status
      status: { S: "uploading" },

      // File paths
      videoS3Key: { S: videoKey },
      agendaS3Key: { S: agendaKey },

      // Timestamps
      updatedAt: { S: new Date().toISOString() },
    };

    // Add custom prompt template ID if provided
    if (body.customPromptTemplateId) {
      item.customPromptTemplateId = { S: body.customPromptTemplateId };
      console.log(
        `INFO: Using custom prompt template: ${body.customPromptTemplateId}`
      );
    } else {
      console.log("INFO: Using default prompt template");
    }

    const putCommand = new PutItemCommand({
      TableName: process.env.MEETINGS_TABLE_NAME,
      Item: item,
    });

    await dynamoClient.send(putCommand);

    console.log(
      `INFO: Meeting ${meetingId} associated with user ${userId} (${userEmail})`
    );
    console.log(
      "INFO: Generated presigned URLs for uploading:",
      videoPresignedUrl,
      agendaPresignedUrl
    );

    const responseBody: ResponseBody = {
      meetingId,
      videoPresignedUrl,
      agendaPresignedUrl,
    };

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify(responseBody),
    };
  } catch (error) {
    console.error("ERROR: Failed to generate presigned URLs:", error);
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
