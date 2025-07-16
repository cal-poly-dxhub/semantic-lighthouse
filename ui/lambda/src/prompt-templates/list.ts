import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { DynamoDBClient, ScanCommand } from "@aws-sdk/client-dynamodb";

const dynamodb = new DynamoDBClient({});

const PROMPT_TEMPLATES_TABLE_NAME = process.env.PROMPT_TEMPLATES_TABLE_NAME!;

interface PromptTemplate {
  templateId: string;
  createdAt: string;
  title: string;
  status: "processing" | "available" | "failed";
  customPrompt?: string;
  errorMessage?: string;
  updatedAt: string;
}

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  console.log("Event:", JSON.stringify(event, null, 2));

  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
    "Access-Control-Allow-Methods": "GET,OPTIONS",
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

    // Extract query parameters
    const queryParams = event.queryStringParameters || {};
    const includeProcessing = queryParams.includeProcessing === "true";

    // Scan the prompt templates table
    const scanParams: any = {
      TableName: PROMPT_TEMPLATES_TABLE_NAME,
    };

    // Filter by status if not including processing templates
    if (!includeProcessing) {
      scanParams.FilterExpression = "#status = :available";
      scanParams.ExpressionAttributeNames = {
        "#status": "status",
      };
      scanParams.ExpressionAttributeValues = {
        ":available": { S: "available" },
      };
    }

    const result = await dynamodb.send(new ScanCommand(scanParams));

    const templates: PromptTemplate[] = (result.Items || [])
      .map((item: any) => ({
        templateId: item.templateId?.S || "",
        createdAt: item.createdAt?.S || "",
        title: item.title?.S || "",
        status: item.status?.S || "processing",
        customPrompt: item.customPrompt?.S,
        errorMessage: item.errorMessage?.S,
        updatedAt: item.updatedAt?.S || "",
      }))
      .sort(
        (a: PromptTemplate, b: PromptTemplate) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );

    console.log(`Found ${templates.length} prompt templates`);

    return {
      statusCode: 200,
      headers: corsHeaders,
      body: JSON.stringify({
        templates,
        count: templates.length,
      }),
    };
  } catch (error) {
    console.error("Error listing prompt templates:", error);

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
