import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import cloudfront from "aws-sdk/clients/cloudfront";

interface ResponseBody {
  videoId: string;
  //   videoTitle: string;
  videoUrl: string;
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token",
  "Access-Control-Allow-Methods": "GET",
  "Content-Type": "application/json",
};

/**
 *
 * @param event
 */
export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  // log for debug
  console.log("INFO: Received event:", JSON.stringify(event, null, 2));

  try {
    if (event.httpMethod !== "GET") {
      return {
        statusCode: 405,
        headers: corsHeaders,
        body: JSON.stringify({
          error: "Method not allowed.",
        }),
      };
    }

    // check bearer token
    // get videoid from query parameters
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

    // Create CloudFront signer
    const signer = new cloudfront.Signer(
      process.env.CLOUDFRONT_ACCESS_KEY_ID!,
      process.env.CLOUDFRONT_PRIVATE_KEY!
    );

    const cloudfrontDomain = process.env.CLOUDFRONT_DOMAIN;
    if (!cloudfrontDomain) {
      throw new Error("CLOUDFRONT_DOMAIN environment variable not set");
    }

    const signedUrl = signer.getSignedUrl({
      url: `https://${cloudfrontDomain}/${videoId}/*`,
      expires: Math.floor(Date.now() / 1000) + 3600,
    });

    const manifestUrl = `https://${cloudfrontDomain}/${videoId}/output.m3u8`;

    const responseBody: ResponseBody = {
      videoId: videoId,
      // videoTitle: // get from dynamo
      videoUrl: manifestUrl,
    };

    // return ResponseBody
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify(responseBody),
    };
  } catch (error) {
    console.error("Error processing question:", error);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({
        error: "Failed to process question",
        details: error instanceof Error ? error.message : "Unknown error",
      }),
    };
  }
};
