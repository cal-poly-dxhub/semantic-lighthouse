import { FeatureType, Textract } from "@aws-sdk/client-textract";
import { S3Event } from "aws-lambda";

/**
 * lambda to process video files uploaded to S3
 * @param event
 */
export const handler = async (event: S3Event): Promise<void> => {
  console.log("Received S3 event:", JSON.stringify(event, null, 2));

  for (const record of event.Records) {
    if (record.eventName?.startsWith("ObjectCreated")) {
      await processPdf(record.s3.bucket.name, record.s3.object.key);
    }
  }
};

/**
 * process a pdf file uploaded to S3
 * @param bucketName
 * @param objectKey
 * @returns
 */
async function processPdf(
  bucketName: string,
  objectKey: string
): Promise<void> {
  try {
    // only process pdf and if not already processed
    if (
      objectKey.includes("postprocessed.json") ||
      objectKey.includes("headers.json") ||
      !objectKey.endsWith(".pdf")
    ) {
      console.log(
        `INFO: Skipping ${objectKey} - not a PDF file or already processed`
      );
      return;
    }

    console.log(`INFO: Processing file: ${objectKey}`);

    // start the textract job
    const textract = new Textract();
    const params = {
      DocumentLocation: {
        S3Object: {
          Bucket: bucketName,
          Name: objectKey,
        },
      },
      FeatureTypes: [FeatureType.TABLES, FeatureType.FORMS],
      OutputConfig: {
        S3Bucket: bucketName,
        S3Prefix: `${objectKey.split("/")[0]}/textract/`,
      },
    };

    const response = await textract.startDocumentAnalysis(params);

    if (!response.JobId) {
      throw new Error("Textract job ID not returned");
    }

    console.log(`INFO: Started Textract job: ${response.JobId}`);

    return;
  } catch (error) {
    console.error("ERROR: Error processing file:", error);
    throw error;
  }
}
