import { DynamoDBClient, ScanCommand } from "@aws-sdk/client-dynamodb";
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
 * lambda to generate presigned url for video.mp4
 * @param event
 */
export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  console.log("INFO: Received event:", JSON.stringify(event, null, 2));

  try {
    // query dynamo for all meetings
    const result = await dynamoClient.send(
      new ScanCommand({
        TableName: process.env.MEETINGS_TABLE_NAME,
      })
    );

    console.log("INFO: DynamoDB Scan result:", JSON.stringify(result));

    if (!result.Items || result.Items.length === 0) {
      return {
        statusCode: 404,
        headers: corsHeaders,
        body: JSON.stringify({
          error: "No meetings found.",
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
        status: "n/a",
      })),
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
