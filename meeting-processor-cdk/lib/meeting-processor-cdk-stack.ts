import * as cdk from "aws-cdk-lib";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as s3n from "aws-cdk-lib/aws-s3-notifications";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as stepfunctions from "aws-cdk-lib/aws-stepfunctions";
import * as sns from "aws-cdk-lib/aws-sns";
import * as iam from "aws-cdk-lib/aws-iam";
import * as events from "aws-cdk-lib/aws-events";
import * as targets from "aws-cdk-lib/aws-events-targets";
import * as path from "path";
import * as fs from "fs";
import { Construct } from "constructs";

export interface MeetingProcessorCdkStackProps extends cdk.StackProps {
  /**
   * The name of the S3 bucket for storing all meeting files.
   * If not provided, CDK will auto-generate a unique bucket name.
   * @default undefined (auto-generated)
   */
  readonly s3BucketName?: string;

  /**
   * Prefix for resource names to ensure uniqueness in customer environments.
   * Combined with account ID and region to create AWS-compliant unique names.
   * @default 'semantic-lighthouse'
   * @example 'semantic-lighthouse' becomes 'semantic-lighthouse-123456-uswest2'
   */
  readonly resourcePrefix?: string;
}

/**
 * Semantic Lighthouse Meeting Processor CDK Stack
 *
 * This stack deploys a complete serverless meeting processing pipeline that:
 * - Converts video recordings to audio and transcripts
 * - Uses AI to analyze transcripts and generate meeting minutes
 * - Processes agenda documents for enhanced context
 * - Generates interactive HTML and PDF outputs with clickable video links
 * - Sends email notifications when processing is complete
 *
 * All resources are automatically named with unique prefixes to avoid conflicts.
 */
export class MeetingProcessorCdkStack extends cdk.Stack {
  public readonly s3Bucket: s3.Bucket;
  public readonly stateMachine: stepfunctions.StateMachine;
  public readonly emailNotificationTopic: sns.Topic;

  constructor(
    scope: Construct,
    id: string,
    props: MeetingProcessorCdkStackProps = {}
  ) {
    super(scope, id, props);

    // Resource prefix for uniqueness - simplified to meet AWS naming constraints
    const resourcePrefix = props.resourcePrefix || "semantic-lighthouse";
    // Use stack ID for uniqueness instead of account/region tokens to avoid CDK token issues
    const stackSuffix = cdk.Names.uniqueId(this)
      .toLowerCase()
      .replace(/[^a-zA-Z0-9-]/g, "")
      .slice(0, 8);
    const uniquePrefix = `${resourcePrefix}-${stackSuffix}`;

    // =================================================================
    // CONFIGURATION FILES - Read prompt templates at deployment time
    // =================================================================

    // Read prompt templates from config files
    const transcriptPromptTemplate = fs.readFileSync(
      path.join(__dirname, "../config/prompts/transcript-analysis.txt"),
      "utf8"
    );
    const fallbackAgendaText = fs.readFileSync(
      path.join(__dirname, "../config/prompts/fallback-agenda.txt"),
      "utf8"
    );

    // =================================================================
    // S3 BUCKET - Central storage for all meeting files
    // =================================================================

    this.s3Bucket = new s3.Bucket(this, "MeetingFilesBucket", {
      // Only use explicit bucket name if provided, otherwise let CDK auto-generate
      // This ensures global uniqueness for different deployments/accounts
      bucketName: props.s3BucketName,
      versioned: false,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      lifecycleRules: [
        {
          id: "DeleteOldFiles",
          enabled: true,
          expiration: cdk.Duration.days(90),
          prefix: "uploads/",
        },
        {
          id: "DeleteOldTranscriptions",
          enabled: true,
          expiration: cdk.Duration.days(365),
          prefix: "transcriptions/",
        },
      ],
      // Enable EventBridge notifications
      eventBridgeEnabled: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // =================================================================
    // SNS TOPIC - Email notifications
    // =================================================================
    this.emailNotificationTopic = new sns.Topic(
      this,
      "EmailNotificationTopic",
      {
        topicName: `${uniquePrefix}-notifications`,
        displayName: "Semantic Lighthouse Meeting Processor Notifications",
      }
    );

    // =================================================================
    // LAMBDA LAYERS - Video analysis and PDF generation tools
    // =================================================================

    // Video analysis layer for extracting metadata from video files
    const videoAnalysisLayer = new lambda.LayerVersion(
      this,
      "VideoAnalysisLayer",
      {
        layerVersionName: `${uniquePrefix}-video-analysis-tools`,
        code: lambda.Code.fromAsset(
          path.join(__dirname, "../lambda/layers/pymediainfo_layer")
        ),
        compatibleRuntimes: [lambda.Runtime.PYTHON_3_12],
        description:
          "Video metadata extraction tools for analyzing uploaded meeting recordings",
      }
    );

    // PDF generation layer with fonts and dependencies
    const pdfGenerationLayer = new lambda.LayerVersion(
      this,
      "PdfGenerationLayer",
      {
        layerVersionName: `${uniquePrefix}-pdf-generation-tools`,
        code: lambda.Code.fromAsset(
          path.join(__dirname, "../lambda/layers/weasyprint")
        ),
        compatibleRuntimes: [lambda.Runtime.PYTHON_3_12],
        description:
          "PDF generation tools with fonts for converting HTML meeting minutes to PDF",
      }
    );

    // =================================================================
    // LAMBDA FUNCTIONS - Meeting processing pipeline
    // =================================================================

    // 1. Video to Audio Converter - Converts uploaded videos to audio for transcription
    const videoToAudioConverter = new lambda.Function(
      this,
      "VideoToAudioConverter",
      {
        functionName: `${uniquePrefix}-video-to-audio-converter`,
        runtime: lambda.Runtime.PYTHON_3_12,
        code: lambda.Code.fromAsset("lambda/src/mediaconvert_trigger"),
        handler: "handler.lambda_handler",
        timeout: cdk.Duration.minutes(15),
        memorySize: 2048,
        layers: [videoAnalysisLayer],
        environment: {
          BUCKET_NAME: this.s3Bucket.bucketName,
          OUTPUT_BUCKET: this.s3Bucket.bucketName,
        },
      }
    );

    // 2. Processing Status Monitor - Monitors conversion jobs and file availability
    const processingStatusMonitor = new lambda.Function(
      this,
      "ProcessingStatusMonitor",
      {
        functionName: `${uniquePrefix}-processing-status-monitor`,
        runtime: lambda.Runtime.PYTHON_3_12,
        code: lambda.Code.fromAsset("lambda/src/verify_s3_file"),
        handler: "handler.lambda_handler",
        timeout: cdk.Duration.minutes(5),
        memorySize: 512,
        environment: {
          BUCKET_NAME: this.s3Bucket.bucketName,
        },
      }
    );

    // 3. AI Meeting Analyzer - Uses AI to analyze transcripts and generate meeting minutes
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
        S3_BUCKET: this.s3Bucket.bucketName,
        TRANSCRIPT_MODEL_ID: "us.anthropic.claude-3-7-sonnet-20250219-v1:0",
        TRANSCRIPT_MAX_TOKENS: "8000",
        TRANSCRIPT_TEMPERATURE: "0.2",
        TRANSCRIPT_PROMPT_TEMPLATE: transcriptPromptTemplate,
        FALLBACK_AGENDA_TEXT: fallbackAgendaText,
      },
    });

    // 4. Document PDF Generator - Converts HTML meeting minutes to PDF format
    const documentPdfGenerator = new lambda.Function(
      this,
      "DocumentPdfGenerator",
      {
        functionName: `${uniquePrefix}-document-pdf-generator`,
        runtime: lambda.Runtime.PYTHON_3_12,
        code: lambda.Code.fromAsset("lambda/src/html_to_pdf"),
        handler: "handler.lambda_handler",
        timeout: cdk.Duration.minutes(5),
        memorySize: 1536,
        layers: [pdfGenerationLayer],
        environment: {
          BUCKET_NAME: this.s3Bucket.bucketName,
          LD_LIBRARY_PATH: "/opt/lib",
          FONTCONFIG_PATH: "/opt/fonts",
        },
      }
    );

    // 5. Notification Sender - Sends email notifications when processing is complete
    const notificationSender = new lambda.Function(this, "NotificationSender", {
      functionName: `${uniquePrefix}-notification-sender`,
      runtime: lambda.Runtime.PYTHON_3_12,
      code: lambda.Code.fromAsset("lambda/src/email_sender"),
      handler: "handler.lambda_handler",
      timeout: cdk.Duration.minutes(1),
      memorySize: 256,
      environment: {
        SNS_TOPIC_ARN: this.emailNotificationTopic.topicArn,
        NOTIFICATION_EMAIL: "user@example.com", // User can update this via console
      },
    });

    // =================================================================
    // IAM PERMISSIONS - Grant necessary permissions to Lambda functions
    // =================================================================

    // S3 permissions for all functions
    this.s3Bucket.grantReadWrite(videoToAudioConverter);
    this.s3Bucket.grantReadWrite(processingStatusMonitor);
    this.s3Bucket.grantReadWrite(aiMeetingAnalyzer);
    this.s3Bucket.grantReadWrite(documentPdfGenerator);
    this.s3Bucket.grantRead(notificationSender);

    // SNS permissions for notification sender
    this.emailNotificationTopic.grantPublish(notificationSender);

    // Grant SNS subscribe and list permissions for confirmation flow
    notificationSender.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ["sns:Subscribe", "sns:ListSubscriptionsByTopic"],
        resources: [this.emailNotificationTopic.topicArn],
      })
    );

    // MediaConvert permissions for video conversion
    videoToAudioConverter.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          "mediaconvert:CreateJob",
          "mediaconvert:GetJob",
          "mediaconvert:ListJobs",
          "mediaconvert:DescribeEndpoints",
        ],
        resources: ["*"],
      })
    );

    // IAM PassRole permission for MediaConvert
    videoToAudioConverter.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ["iam:PassRole"],
        resources: ["*"],
        conditions: {
          StringEquals: {
            "iam:PassedToService": "mediaconvert.amazonaws.com",
          },
        },
      })
    );

    // MediaConvert permissions for ProcessingStatusMonitor (to check job status)
    processingStatusMonitor.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ["mediaconvert:GetJob", "mediaconvert:ListJobs"],
        resources: ["*"],
      })
    );

    // Transcribe permissions for video converter and status monitor
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

    // Bedrock permissions for AI analysis
    aiMeetingAnalyzer.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          "bedrock:InvokeModel",
          "bedrock:InvokeModelWithResponseStream",
        ],
        resources: [
          `arn:aws:bedrock:us-west-2:${this.account}:inference-profile/us.anthropic.claude-3-7-sonnet-20250219-v1:0`,
          "arn:aws:bedrock:us-east-1::foundation-model/anthropic.claude-3-7-sonnet-20250219-v1:0",
          "arn:aws:bedrock:us-east-2::foundation-model/anthropic.claude-3-7-sonnet-20250219-v1:0",
          "arn:aws:bedrock:us-west-2::foundation-model/anthropic.claude-3-7-sonnet-20250219-v1:0",
        ],
      })
    );

    // =================================================================
    // STEP FUNCTIONS STATE MACHINE - Main workflow orchestration
    // =================================================================

    // Read the state machine definition and substitute variables
    let stateMachineDefinitionString = fs.readFileSync(
      "statemachine/transcribe.asl.json",
      "utf8"
    );

    // Replace placeholders with actual ARNs and values
    stateMachineDefinitionString = stateMachineDefinitionString
      .replace(
        /\$\{MediaConvertLambdaArn\}/g,
        videoToAudioConverter.functionArn
      )
      .replace(
        /\$\{VerifyS3FileLambdaArn\}/g,
        processingStatusMonitor.functionArn
      )
      .replace(
        /\$\{ProcessTranscriptLambdaArn\}/g,
        aiMeetingAnalyzer.functionArn
      )
      .replace(/\$\{HtmlToPdfFunctionArn\}/g, documentPdfGenerator.functionArn)
      .replace(/\$\{EmailSenderLambdaArn\}/g, notificationSender.functionArn)
      .replace(/\$\{OutputBucketName\}/g, this.s3Bucket.bucketName);

    const stateMachineDefinition = stepfunctions.DefinitionBody.fromString(
      stateMachineDefinitionString
    );

    this.stateMachine = new stepfunctions.StateMachine(
      this,
      "MeetingProcessingWorkflow",
      {
        stateMachineName: `${uniquePrefix}-processing-workflow`,
        definitionBody: stateMachineDefinition,
        timeout: cdk.Duration.hours(4),
      }
    );

    // Add Transcribe permissions to Step Functions state machine role
    this.stateMachine.addToRolePolicy(
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

    // Add S3 permissions to Step Functions state machine role (for transcribe output)
    this.stateMachine.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"],
        resources: [`${this.s3Bucket.bucketArn}/*`],
      })
    );

    // Grant state machine permissions to invoke Lambda functions
    [
      videoToAudioConverter,
      processingStatusMonitor,
      aiMeetingAnalyzer,
      documentPdfGenerator,
      notificationSender,
    ].forEach((func) => {
      func.grantInvoke(this.stateMachine);
    });

    // =================================================================
    // AGENDA PROCESSOR FUNCTION - Created after state machine for ARN reference
    // =================================================================

    // Create a dedicated IAM role with full Bedrock access for the agenda document processor
    const agendaProcessorRole = new iam.Role(this, "AgendaProcessorRole", {
      roleName: `${uniquePrefix}-agenda-processor-role`,
      assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
      description:
        "Role for Semantic Lighthouse Agenda Document Processor Lambda with full Amazon Bedrock access",
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          "service-role/AWSLambdaBasicExecutionRole"
        ),
        iam.ManagedPolicy.fromAwsManagedPolicyName("AmazonBedrockFullAccess"),
      ],
    });

    // 6. Agenda Document Processor - Analyzes uploaded meeting agendas using AI
    const agendaDocumentProcessor = new lambda.Function(
      this,
      "AgendaDocumentProcessor",
      {
        functionName: `${uniquePrefix}-agenda-document-processor`,
        runtime: lambda.Runtime.PYTHON_3_12,
        code: lambda.Code.fromAsset("lambda/src/agenda_processor"),
        handler: "handler.lambda_handler",
        timeout: cdk.Duration.minutes(15), // Maximum Lambda timeout
        memorySize: 1024,
        role: agendaProcessorRole,
        environment: {
          BUCKET_NAME: this.s3Bucket.bucketName,
          STATE_MACHINE_ARN: this.stateMachine.stateMachineArn,
          AGENDA_MODEL_ID: "us.anthropic.claude-sonnet-4-20250514-v1:0",
          AGENDA_MAX_TOKENS: "65535",
          AGENDA_TEMPERATURE: "0.1",
        },
      }
    );

    // Additional IAM permissions for AgendaDocumentProcessor
    this.s3Bucket.grantReadWrite(agendaDocumentProcessor);

    // Textract permissions for AgendaDocumentProcessor
    agendaDocumentProcessor.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          "textract:StartDocumentTextDetection",
          "textract:GetDocumentTextDetection",
        ],
        resources: ["*"],
      })
    );

    // Bedrock permissions for AgendaDocumentProcessor (Nova Premier)
    agendaDocumentProcessor.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ["bedrock:InvokeModel"],
        resources: [
          "arn:aws:bedrock:us-east-1::foundation-model/amazon.nova-premier-v1:0",
          "arn:aws:bedrock:us-west-2::foundation-model/amazon.nova-premier-v1:0",
        ],
      })
    );

    // Marketplace subscribe permissions for third-party models
    agendaDocumentProcessor.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          "aws-marketplace:Subscribe",
          "aws-marketplace:Unsubscribe",
          "aws-marketplace:ViewSubscriptions",
        ],
        resources: ["*"],
      })
    );

    // Step Functions permissions for AgendaDocumentProcessor (to trigger combined processing)
    agendaDocumentProcessor.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ["states:StartExecution"],
        resources: [this.stateMachine.stateMachineArn],
      })
    );

    // STS permissions for AgendaDocumentProcessor (to get account ID)
    agendaDocumentProcessor.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ["sts:GetCallerIdentity"],
        resources: ["*"],
      })
    );

    // =================================================================
    // S3 EVENT TRIGGERS - Start workflows when files are uploaded
    // =================================================================

    // EventBridge rule for video uploads
    const s3VideoUploadRule = new events.Rule(this, "S3VideoUploadRule", {
      eventPattern: {
        source: ["aws.s3"],
        detailType: ["Object Created"],
        detail: {
          bucket: {
            name: [this.s3Bucket.bucketName],
          },
          object: {
            key: [{ prefix: "uploads/meeting_recordings/" }],
          },
        },
      },
    });

    // Add Step Functions as target for video uploads
    s3VideoUploadRule.addTarget(
      new targets.SfnStateMachine(this.stateMachine, {
        input: events.RuleTargetInput.fromEventPath("$"),
      })
    );

    // EventBridge rule for agenda uploads
    const s3AgendaUploadRule = new events.Rule(this, "S3AgendaUploadRule", {
      eventPattern: {
        source: ["aws.s3"],
        detailType: ["Object Created"],
        detail: {
          bucket: {
            name: [this.s3Bucket.bucketName],
          },
          object: {
            key: [{ prefix: "uploads/agenda_documents/" }],
          },
        },
      },
    });

    // Add Agenda Document Processor as target for agenda uploads
    s3AgendaUploadRule.addTarget(
      new targets.LambdaFunction(agendaDocumentProcessor, {
        event: events.RuleTargetInput.fromEventPath("$"),
      })
    );

    // =================================================================
    // OUTPUTS - Export important ARNs and names
    // =================================================================

    new cdk.CfnOutput(this, "S3BucketName", {
      value: this.s3Bucket.bucketName,
      description: "Semantic Lighthouse S3 bucket for meeting files storage",
    });

    new cdk.CfnOutput(this, "StateMachineArn", {
      value: this.stateMachine.stateMachineArn,
      description: "Semantic Lighthouse meeting processing workflow ARN",
    });

    new cdk.CfnOutput(this, "EmailNotificationTopicArn", {
      value: this.emailNotificationTopic.topicArn,
      description: "Semantic Lighthouse SNS topic for email notifications",
    });

    new cdk.CfnOutput(this, "AgendaDocumentProcessorArn", {
      value: agendaDocumentProcessor.functionArn,
      description:
        "Semantic Lighthouse agenda document processor Lambda function ARN",
    });
  }
}
