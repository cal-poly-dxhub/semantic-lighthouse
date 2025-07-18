"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handler = void 0;
const client_dynamodb_1 = require("@aws-sdk/client-dynamodb");
const client_s3_1 = require("@aws-sdk/client-s3");
const s3_request_presigner_1 = require("@aws-sdk/s3-request-presigner");
const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token",
    "Access-Control-Allow-Methods": "GET",
    "Content-Type": "application/json",
};
const s3Client = new client_s3_1.S3Client({});
const dynamoClient = new client_dynamodb_1.DynamoDBClient({});
/**
 * Extract user information from JWT token in Authorization header
 */
function extractUserFromToken(event) {
    try {
        // Get the authorization header
        const authHeader = event.headers.Authorization || event.headers.authorization;
        if (!authHeader || !authHeader.startsWith("Bearer ")) {
            console.error("ERROR: No valid authorization header found");
            return null;
        }
        // Extract JWT token (Bearer <token>)
        const token = authHeader.split(" ")[1];
        // Decode JWT payload (middle section between dots)
        const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64").toString());
        const userId = payload["cognito:username"] || payload.sub;
        const userEmail = payload.email;
        if (!userId || !userEmail) {
            console.error("ERROR: Missing userId or userEmail in JWT payload", payload);
            return null;
        }
        return { userId, userEmail };
    }
    catch (error) {
        console.error("ERROR: Failed to extract user from token:", error);
        return null;
    }
}
/**
 * lambda to generate presigned url for private video.mp4 with user ownership verification
 * @param event
 */
const handler = async (event) => {
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
        // VERIFY USER OWNS THIS MEETING
        // =================================================================
        const getItemCommand = new client_dynamodb_1.GetItemCommand({
            TableName: process.env.MEETINGS_TABLE_NAME,
            Key: {
                meetingId: { S: meetingId },
                createdAt: { S: "temp" }, // We need to get the actual createdAt, or use a different approach
            },
        });
        // Since we have composite key, let's query by meetingId first
        const queryCommand = new client_dynamodb_1.QueryCommand({
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
            console.warn(`WARN: User ${userId} attempted to access meeting ${meetingId} owned by ${meeting.userId?.S}`);
            return {
                statusCode: 403,
                headers: corsHeaders,
                body: JSON.stringify({
                    error: "Access denied. You can only access your own meetings.",
                }),
            };
        }
        // =================================================================
        // GENERATE VIDEO URL FOR USER'S MEETING
        // =================================================================
        const key = `uploads/meeting_recordings/${meetingId}.mp4`;
        // Use CloudFront for better performance and CDN delivery
        const cloudFrontDomain = process.env.CLOUDFRONT_DOMAIN_NAME;
        let videoUrl;
        if (cloudFrontDomain) {
            // Use CloudFront URL for private videos (auth handled by this API)
            videoUrl = `https://${cloudFrontDomain}/${key}`;
            console.log(`INFO: Generated CloudFront URL for private video - user ${userId}, meeting ${meetingId}: ${videoUrl}`);
        }
        else {
            // Fallback to S3 presigned URL if CloudFront not configured
            console.warn("CloudFront domain not configured, falling back to S3 presigned URL");
            const command = new client_s3_1.GetObjectCommand({
                Bucket: process.env.MEETINGS_BUCKET_NAME,
                Key: key,
            });
            videoUrl = await (0, s3_request_presigner_1.getSignedUrl)(s3Client, command, {
                expiresIn: 14400, // 4 hours
            });
            console.log(`INFO: Generated S3 presigned URL for private video - user ${userId}, meeting ${meetingId}`);
        }
        const responseBody = {
            meetingId,
            presignedUrl: videoUrl,
        };
        return {
            statusCode: 200,
            headers: corsHeaders,
            body: JSON.stringify(responseBody),
        };
    }
    catch (error) {
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
exports.handler = handler;
