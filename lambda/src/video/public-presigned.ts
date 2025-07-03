import { DynamoDBClient, QueryCommand } from "@aws-sdk/client-dynamodb";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";

interface ResponseBody {
  videoId: string;
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
 * lambda to generate presigned url for video.mp4
 * @param event
 */
export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  console.log("INFO: Received event:", JSON.stringify(event, null, 2));

  const videoId = event.queryStringParameters?.videoId;
  if (!videoId) {
    return {
      statusCode: 400,
      headers: corsHeaders,
      body: JSON.stringify({
        error: "Missing videoId parameter.",
      }),
    };
  }

  try {
    // TODO: make everything meetingId instead of videoId
    // query dynamo for videoId (meetingId)
    const queryCommand = new QueryCommand({
      TableName: process.env.MEETINGS_TABLE_NAME,
      KeyConditionExpression: "meetingId = :meetingId",
      ExpressionAttributeValues: {
        ":meetingId": { S: videoId },
      },
    });

    const result = await dynamoClient.send(queryCommand);

    console.log(
      "INFO: DynamoDB Query result:",
      JSON.stringify(result, null, 2)
    );

    if (!result.Items || result.Items.length === 0) {
      return {
        statusCode: 404,
        headers: corsHeaders,
        body: JSON.stringify({
          error: "Video not found.",
        }),
      };
    }

    // Get the first item (there should only be one with the same meetingId)
    const item = result.Items[0];

    if (item.videoVisibility?.S !== "public") {
      return {
        statusCode: 403,
        headers: corsHeaders,
        body: JSON.stringify({
          error: "Video is not public.",
        }),
      };
    }

    const key = `${videoId}/video.mp4`;

    const command = new GetObjectCommand({
      Bucket: process.env.MEETINGS_BUCKET_NAME,
      Key: key,
    });

    const presignedUrl = await getSignedUrl(s3Client, command, {
      expiresIn: 14400,
    });

    // TODO: maybe log user as well
    console.log("INFO: Generated presigned URL:", presignedUrl);

    const responseBody: ResponseBody = {
      videoId,
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
