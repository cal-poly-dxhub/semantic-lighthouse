import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { v4 as uuidv4 } from "uuid";

const s3Client = new S3Client({});

const BUCKET_NAME = process.env.MEETINGS_BUCKET_NAME!;

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  console.log("Event:", JSON.stringify(event, null, 2));

  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
    "Access-Control-Allow-Methods": "POST,OPTIONS",
  };

  try {
    // Handle CORS preflight
    if (event.httpMethod === "OPTIONS") {
      return {
        statusCode: 200,
        headers: corsHeaders,
        body: "",
      };
    }

    // Parse request body
    const body = event.body ? JSON.parse(event.body) : {};
    const { title } = body;

    if (!title) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({
          error: "Missing required field: title",
        }),
      };
    }

    // Validate title
    if (typeof title !== "string" || title.trim().length === 0) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({
          error: "Title must be a non-empty string",
        }),
      };
    }

    if (title.length > 100) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({
          error: "Title must be 100 characters or less",
        }),
      };
    }

    // Generate unique template ID
    const templateId = uuidv4();

    // Sanitize title for filename (replace spaces and special chars with underscores)
    const sanitizedTitle = title
      .trim()
      .replace(/[^a-zA-Z0-9\s]/g, "")
      .replace(/\s+/g, "_");

    // Generate S3 key
    const objectKey = `uploads/prompt_templates/${templateId}_${sanitizedTitle}.pdf`;

    console.log(`Generating presigned URL for: ${objectKey}`);

    // Create presigned URL for PUT operation
    const putObjectCommand = new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: objectKey,
      ContentType: "application/pdf",
      Metadata: {
        templateId,
        title: title.trim(),
        uploadedAt: new Date().toISOString(),
      },
    });

    const presignedUrl = await getSignedUrl(s3Client, putObjectCommand, {
      expiresIn: 3600, // 1 hour
    });

    console.log(`Generated presigned URL for template: ${templateId}`);

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        templateId,
        title: title.trim(),
        uploadUrl: presignedUrl,
        objectKey,
        expiresIn: 3600,
      }),
    };
  } catch (error) {
    console.error("Error generating prompt template upload URL:", error);

    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({
        error: "Internal server error",
        message: error instanceof Error ? error.message : "Unknown error",
      }),
    };
  }
};
