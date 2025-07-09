import * as cdk from "aws-cdk-lib";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as iam from "aws-cdk-lib/aws-iam";
import * as path from "path";
import * as fs from "fs";
import { Construct } from "constructs";

export interface ProcessingFunctionsProps {
  uniquePrefix: string;
  meetingsBucket: s3.Bucket;
  meetingsTable: cdk.aws_dynamodb.Table;
  emailNotificationTopicArn: string;
}

export interface ProcessingFunctions {
  videoToAudioConverter: lambda.Function;
  processingStatusMonitor: lambda.Function;
  aiMeetingAnalyzer: lambda.Function;
  documentPdfGenerator: lambda.Function;
  notificationSender: lambda.Function;
}

export class ProcessingFunctionsResources extends Construct {
  public readonly functions: ProcessingFunctions;

  constructor(scope: Construct, id: string, props: ProcessingFunctionsProps) {
    super(scope, id);

    const { uniquePrefix, meetingsBucket, meetingsTable, emailNotificationTopicArn } = props;

    // Read prompt templates from config files
    const transcriptPromptTemplate = fs.readFileSync(
      path.join(__dirname, "../config/prompts/transcript-analysis.txt"),
      "utf8"
    );
    const fallbackAgendaText = fs.readFileSync(
      path.join(__dirname, "../config/prompts/fallback-agenda.txt"),
      "utf8"
    );

    // Lambda Layers
    const videoAnalysisLayer = new lambda.LayerVersion(this, "VideoAnalysisLayer", {
      layerVersionName: `${uniquePrefix}-video-analysis-tools`,
      code: lambda.Code.fromAsset(path.join(__dirname, "../lambda/layers/pymediainfo_layer")),
      compatibleRuntimes: [lambda.Runtime.PYTHON_3_12],
      description: "Video metadata extraction tools for analyzing uploaded meeting recordings",
    });

    const pdfGenerationLayer = new lambda.LayerVersion(this, "PdfGenerationLayer", {
      layerVersionName: `${uniquePrefix}-pdf-generation-tools`,
      code: lambda.Code.fromAsset(path.join(__dirname, "../lambda/layers/weasyprint")),
      compatibleRuntimes: [lambda.Runtime.PYTHON_3_12],
      description: "PDF generation tools with fonts for converting HTML meeting minutes to PDF",
    });

    // Lambda Functions
    const videoToAudioConverter = new lambda.Function(this, "VideoToAudioConverter", {
      functionName: `${uniquePrefix}-video-to-audio-converter`,
      runtime: lambda.Runtime.PYTHON_3_12,
      code: lambda.Code.fromAsset("lambda/src/mediaconvert_trigger"),
      handler: "handler.lambda_handler",
      timeout: cdk.Duration.minutes(15),
      memorySize: 2048,
      layers: [videoAnalysisLayer],
      environment: {
        BUCKET_NAME: meetingsBucket.bucketName,
        OUTPUT_BUCKET: meetingsBucket.bucketName,
      },
    });

    const processingStatusMonitor = new lambda.Function(this, "ProcessingStatusMonitor", {
      functionName: `${uniquePrefix}-processing-status-monitor`,
      runtime: lambda.Runtime.PYTHON_3_12,
      code: lambda.Code.fromAsset("lambda/src/verify_s3_file"),
      handler: "handler.lambda_handler",
      timeout: cdk.Duration.minutes(5),
      memorySize: 512,
      environment: {
        BUCKET_NAME: meetingsBucket.bucketName,
      },
    });

    const aiMeetingAnalyzer = new lambda.Function(this, "AiMeetingAnalyzer", {
      functionName: `${uniquePrefix}-ai-meeting-analyzer`,
      runtime: lambda.Runtime.PYTHON_3_12,
      code: lambda.Code.fromAsset("lambda/src/process_transcript", {
        bundling: {
          image: lambda.Runtime.PYTHON_3_12.bundlingImage,
          command: [
            "bash",
            "-c",
            "pip install -r requirements.txt -t /asset-output && cp -au . /asset-output",
          ],
        },
      }),
      handler: "handler.lambda_handler",
      timeout: cdk.Duration.minutes(15),
      memorySize: 4096,
      environment: {
        S3_BUCKET: meetingsBucket.bucketName,
        TRANSCRIPT_MODEL_ID: "us.anthropic.claude-3-7-sonnet-20250219-v1:0",
        TRANSCRIPT_MAX_TOKENS: "8000",
        TRANSCRIPT_TEMPERATURE: "0.2",
        TRANSCRIPT_PROMPT_TEMPLATE: transcriptPromptTemplate,
        FALLBACK_AGENDA_TEXT: fallbackAgendaText,
      },
    });

    const documentPdfGenerator = new lambda.Function(this, "DocumentPdfGenerator", {
      functionName: `${uniquePrefix}-document-pdf-generator`,
      runtime: lambda.Runtime.PYTHON_3_12,
      code: lambda.Code.fromAsset("lambda/src/html_to_pdf"),
      handler: "handler.lambda_handler",
      timeout: cdk.Duration.minutes(5),
      memorySize: 1536,
      layers: [pdfGenerationLayer],
      environment: {
        BUCKET_NAME: meetingsBucket.bucketName,
        LD_LIBRARY_PATH: "/opt/lib",
        FONTCONFIG_PATH: "/opt/fonts",
      },
    });

    const notificationSender = new lambda.Function(this, "NotificationSender", {
      functionName: `${uniquePrefix}-notification-sender`,
      runtime: lambda.Runtime.PYTHON_3_12,
      code: lambda.Code.fromAsset("lambda/src/email_sender"),
      handler: "handler.lambda_handler",
      timeout: cdk.Duration.minutes(1),
      memorySize: 256,
      environment: {
        SNS_TOPIC_ARN: emailNotificationTopicArn,
        NOTIFICATION_EMAIL: "user@example.com",
      },
    });

    this.functions = {
      videoToAudioConverter,
      processingStatusMonitor,
      aiMeetingAnalyzer,
      documentPdfGenerator,
      notificationSender,
    };

    // Grant permissions
    this.grantPermissions(meetingsBucket, meetingsTable, emailNotificationTopicArn);
  }

  private grantPermissions(
    meetingsBucket: s3.Bucket,
    meetingsTable: cdk.aws_dynamodb.Table,
    emailNotificationTopicArn: string
  ) {
    const { videoToAudioConverter, processingStatusMonitor, aiMeetingAnalyzer, documentPdfGenerator, notificationSender } = this.functions;

    // S3 permissions
    meetingsBucket.grantReadWrite(videoToAudioConverter);
    meetingsBucket.grantReadWrite(processingStatusMonitor);
    meetingsBucket.grantReadWrite(aiMeetingAnalyzer);
    meetingsBucket.grantReadWrite(documentPdfGenerator);
    meetingsBucket.grantRead(notificationSender);

    // DynamoDB permissions
    meetingsTable.grantReadWriteData(aiMeetingAnalyzer);
    meetingsTable.grantReadData(notificationSender);

    // SNS permissions
    notificationSender.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ["sns:Publish", "sns:Subscribe", "sns:ListSubscriptionsByTopic"],
        resources: [emailNotificationTopicArn],
      })
    );

    // MediaConvert permissions
    videoToAudioConverter.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          "mediaconvert:CreateJob",
          "mediaconvert:GetJob",
          "mediaconvert:ListJobs",
          "mediaconvert:DescribeEndpoints",
          "iam:PassRole",
        ],
        resources: ["*"],
        conditions: {
          StringEquals: {
            "iam:PassedToService": "mediaconvert.amazonaws.com",
          },
        },
      })
    );

    processingStatusMonitor.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ["mediaconvert:GetJob", "mediaconvert:ListJobs"],
        resources: ["*"],
      })
    );

    // Transcribe permissions
    [videoToAudioConverter, processingStatusMonitor].forEach((func) => {
      func.addToRolePolicy(
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: [
            "transcribe:StartTranscriptionJob",
            "transcribe:GetTranscriptionJob",
            "transcribe:ListTranscriptionJobs",
          ],
          resources: ["*"],
        })
      );
    });

    // Bedrock permissions
    aiMeetingAnalyzer.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"],
        resources: [
          `arn:aws:bedrock:us-west-2:${cdk.Aws.ACCOUNT_ID}:inference-profile/us.anthropic.claude-3-7-sonnet-20250219-v1:0`,
          "arn:aws:bedrock:us-east-1::foundation-model/anthropic.claude-3-7-sonnet-20250219-v1:0",
          "arn:aws:bedrock:us-east-2::foundation-model/anthropic.claude-3-7-sonnet-20250219-v1:0",
          "arn:aws:bedrock:us-west-2::foundation-model/anthropic.claude-3-7-sonnet-20250219-v1:0",
        ],
      })
    );
  }
}