"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handler = void 0;
const client_dynamodb_1 = require("@aws-sdk/client-dynamodb");
const client_textract_1 = require("@aws-sdk/client-textract");
// const s3Client = new S3Client();
// const bedrockRuntimeClient = new BedrockRuntime();
const dynamoDbClient = new client_dynamodb_1.DynamoDBClient({});
const textract = new client_textract_1.Textract();
/**
 * lambda to process video files uploaded to S3
 * @param event
 */
const handler = async (event) => {
    console.log("Received S3 event:", JSON.stringify(event, null, 2));
    for (const record of event.Records) {
        if (record.eventName?.startsWith("ObjectCreated")) {
            await processPdf(record.s3.bucket.name, record.s3.object.key);
        }
    }
};
exports.handler = handler;
/**
 * process a pdf file uploaded to S3
 * @param bucketName
 * @param objectKey
 * @returns
 */
async function processPdf(bucketName, objectKey) {
    try {
        // only process pdf and if not already processed
        if (objectKey.includes("postprocessed.json") ||
            objectKey.includes("headers.json") ||
            !objectKey.endsWith(".pdf")) {
            console.log(`INFO: Skipping ${objectKey} - not a PDF file or already processed`);
            return;
        }
        console.log(`INFO: Processing PDF file: ${objectKey}`);
        const meetingId = objectKey.split("/")[0];
        const params = {
            DocumentLocation: {
                S3Object: {
                    Bucket: bucketName,
                    Name: objectKey,
                },
            },
            FeatureTypes: [client_textract_1.FeatureType.TABLES, client_textract_1.FeatureType.FORMS],
            OutputConfig: {
                S3Bucket: bucketName,
                S3Prefix: `${meetingId}/textract/`,
            },
        };
        const response = await textract.startDocumentAnalysis(params);
        if (!response.JobId) {
            throw new Error("Textract job ID not returned");
        }
        console.log(`INFO: Started Textract job: ${response.JobId}`);
        const dynamoUpdateParams = {
            TableName: process.env.MEETINGS_TABLE_NAME,
            Key: {
                PK: { S: meetingId },
            },
            UpdateExpression: "SET #status = :status, textractJobId = :jobId",
            ExpressionAttributeNames: {
                "#status": "status",
            },
            ExpressionAttributeValues: {
                ":status": { S: "textract-processing" },
                ":jobId": { S: response.JobId },
            },
        };
        await dynamoDbClient.send(new client_dynamodb_1.UpdateItemCommand(dynamoUpdateParams));
        return;
        // TODO: move to another lambda to handle Textract job completion
        // const response = await s3Client.send(
        //   new GetObjectCommand({
        //     Bucket: bucketName,
        //     Key: objectKey,
        //   })
        // );
        // if (!response.Body) {
        //   throw new Error(`No body found in S3 object: ${objectKey}`);
        // }
        // const buffer = Buffer.from(await response.Body.transformToByteArray());
        // const pdfData = await pdf(buffer, { max: 8 });
        // console.log(
        //   `INFO: Extracted PDF text: ${pdfData.text.substring(0, 128)}...`
        // );
        // const prompt =
        //   'You will be provided the beginning of a PDF document. Please read the table of contents of this document and respond with a JSON object containing the headings in the document. The headings should be in the format: ["heading1", "heading2", ...]. Do not include any other text in your response.';
        // // invoke bedrock
        // const bedrockResponse = await bedrockRuntimeClient.invokeModel({
        //   modelId: "amazon.nova-pro-v1:0",
        //   body: Buffer.from(
        //     JSON.stringify({
        //       prompt: `${prompt}\n\n${pdfData.text}`,
        //       maxTokens: 1024,
        //       stopSequences: ["\n"],
        //     })
        //   ),
        //   contentType: "text/plain",
        //   accept: "application/json",
        // });
        // const bedrockResponseBody = bedrockResponse.body.transformToString();
        // console.log(
        //   `INFO: Received response from Bedrock model: ${bedrockResponseBody}`
        // );
        // // remove all from the response that is not JSON
        // const jsonStartIndex = bedrockResponseBody.indexOf("[");
        // const jsonEndIndex = bedrockResponseBody.lastIndexOf("]") + 1;
        // const jsonResponse = bedrockResponseBody.substring(
        //   jsonStartIndex,
        //   jsonEndIndex
        // );
        // const headers = JSON.parse(jsonResponse);
        // // save the headers to S3
        // const headersKey = "headers.json";
        // const putCommand = new PutObjectCommand({
        //   Bucket: bucketName,
        //   Key: headersKey,
        //   Body: JSON.stringify(headers),
        //   ContentType: "application/json",
        // });
        // await s3Client.send(putCommand);
        // return;
    }
    catch (error) {
        console.error("ERROR: Error processing file:", error);
        throw error;
    }
}
