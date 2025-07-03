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

/**
 * lambda to generate presigned url for uploading video.mp4 and agenda.pdf
 * @param event
 */
export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  console.log("INFO: Received event:", JSON.stringify(event, null, 2));

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

  try {
    const videoKey = `${meetingId}/video.mp4`;
    const command = new PutObjectCommand({
      Bucket: process.env.MEETINGS_BUCKET_NAME,
      Key: videoKey,
      ContentType: "video/mp4",
    });

    const agendaKey = `${meetingId}/agenda.pdf`;
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

    // store metadata in dynamodb
    const dynamoClient = new DynamoDBClient({});
    const putCommand = new PutItemCommand({
      TableName: process.env.MEETINGS_TABLE_NAME,
      Item: {
        PK: { S: meetingId },
        meetingId: { S: meetingId },
        createdAt: { S: new Date().toISOString() },
        meetingTitle: { S: body.meetingTitle },
        meetingDate: { S: body.meetingDate },
        meetingDescription: { S: body.meetingDescription },
        videoVisibility: { S: body.videoVisibility },
        status: { S: "uploading" },
      },
    });

    await dynamoClient.send(putCommand);

    // TODO: maybe log user as well
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
