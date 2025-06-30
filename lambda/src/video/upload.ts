import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { randomUUID } from "crypto";

interface ResponseBody {
  videoId: string;
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

  // Handle CORS preflight
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: "",
    };
  }

  // Validate environment variables
  if (!process.env.VIDEO_BUCKET_NAME) {
    console.error("ERROR: VIDEO_BUCKET_NAME environment variable not set");
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({
        error: "Server configuration error",
        details: "Missing required environment variables",
      }),
    };
  }

  const videoId = randomUUID();

  try {
    const videoKey = `${videoId}/video.mp4`;
    const command = new PutObjectCommand({
      Bucket: process.env.VIDEO_BUCKET_NAME,
      Key: videoKey,
      ContentType: "video/mp4",
    });

    const agendaKey = `${videoId}/agenda.pdf`;
    const agendaCommand = new PutObjectCommand({
      Bucket: process.env.VIDEO_BUCKET_NAME,
      Key: agendaKey,
      ContentType: "application/pdf",
    });

    const videoPresignedUrl = await getSignedUrl(s3Client, command, {
      expiresIn: 600, // 10 min
    });

    const agendaPresignedUrl = await getSignedUrl(s3Client, agendaCommand, {
      expiresIn: 600, // 10 min
    });

    // TODO: maybe log user as well
    console.log(
      "INFO: Generated presigned URLs for uploading:",
      videoPresignedUrl,
      agendaPresignedUrl
    );

    const responseBody: ResponseBody = {
      videoId,
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
