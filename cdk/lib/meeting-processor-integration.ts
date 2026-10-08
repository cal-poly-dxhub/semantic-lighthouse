import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as path from "path";
import * as fs from "fs";

export interface MeetingProcessorIntegrationProps {
  bucket: cdk.aws_s3.Bucket;
  meetingsTable: cdk.aws_dynamodb.Table;
  userPreferencesTable: cdk.aws_dynamodb.Table;
  videoDistribution: cdk.aws_cloudfront.Distribution;
  frontendDistribution: cdk.aws_cloudfront.Distribution;
}

export class MeetingProcessorIntegration extends Construct {
  public readonly stateMachine: cdk.aws_stepfunctions.StateMachine;
  public readonly agendaProcessor: cdk.aws_lambda.Function;

  constructor(
    scope: Construct,
    id: string,
    props: MeetingProcessorIntegrationProps
  ) {
    super(scope, id);

    // =================================================================
    // CONFIGURATION FILES - Read prompt templates at deployment time
    // =================================================================

    // Read prompt templates from config files
    const transcriptPromptTemplate = fs.readFileSync(
      path.join(
        __dirname,
        "../../meeting-processor-cdk/config/prompts/transcript-analysis.txt"
      ),
      "utf8"
    );
    const fallbackAgendaText = fs.readFileSync(
      path.join(
        __dirname,
        "../../meeting-processor-cdk/config/prompts/fallback-agenda.txt"
      ),
      "utf8"
    );

    // =================================================================
    // LAMBDA LAYERS - Required for video processing and PDF generation
    // =================================================================

    // Video analysis layer with pymediainfo
    const videoAnalysisLayer = new cdk.aws_lambda.LayerVersion(
      this,
      "VideoAnalysisLayer",
      {
        code: cdk.aws_lambda.Code.fromAsset(
          path.join(
            __dirname,
            "../../meeting-processor-cdk/lambda/layers/pymediainfo_layer"
          )
        ),
        compatibleRuntimes: [cdk.aws_lambda.Runtime.PYTHON_3_12],
        description:
          "PyMediaInfo library for video file analysis and duration extraction",
      }
    );

    // PDF generation layer with fonts and dependencies
    const pdfGenerationLayer = new cdk.aws_lambda.LayerVersion(
      this,
      "PdfGenerationLayer",
      {
        code: cdk.aws_lambda.Code.fromAsset(
          path.join(
            __dirname,
            "../../meeting-processor-cdk/lambda/layers/weasyprint"
          )
        ),
        compatibleRuntimes: [cdk.aws_lambda.Runtime.PYTHON_3_12],
        description:
          "PDF generation tools with fonts for converting HTML meeting minutes to PDF",
      }
    );

    // =================================================================
    // MEDIACONVERT SERVICE ROLE - Create MediaConvert service role for video conversion
    // =================================================================

    // Create MediaConvert service role
    const mediaConvertRole = new cdk.aws_iam.Role(
      this,
      "MediaConvertServiceRole",
      {
        assumedBy: new cdk.aws_iam.ServicePrincipal(
          "mediaconvert.amazonaws.com"
        ),
        description: "Service role for MediaConvert to access S3 buckets",
        inlinePolicies: {
          S3Access: new cdk.aws_iam.PolicyDocument({
            statements: [
              new cdk.aws_iam.PolicyStatement({
                effect: cdk.aws_iam.Effect.ALLOW,
                actions: [
                  "s3:GetObject",
                  "s3:PutObject",
                  "s3:DeleteObject",
                  "s3:GetObjectVersion",
                ],
                resources: [`${props.bucket.bucketArn}/*`],
              }),
              new cdk.aws_iam.PolicyStatement({
                effect: cdk.aws_iam.Effect.ALLOW,
                actions: ["s3:ListBucket", "s3:GetBucketLocation"],
                resources: [props.bucket.bucketArn],
              }),
            ],
          }),
        },
      }
    );

    // =================================================================
    // LAMBDA FUNCTIONS - Meeting processing pipeline with database integration
    // =================================================================

    // 1. Video to Audio Converter
    const videoToAudioConverter = new cdk.aws_lambda.Function(
      this,
      "VideoToAudioConverter",
      {
        runtime: cdk.aws_lambda.Runtime.PYTHON_3_12,
        code: cdk.aws_lambda.Code.fromAsset(
          "../meeting-processor-cdk/lambda/src/mediaconvert_trigger"
        ),
        handler: "handler.lambda_handler",
        timeout: cdk.Duration.minutes(15),
        memorySize: 2048,
        layers: [videoAnalysisLayer],
        environment: {
          BUCKET_NAME: props.bucket.bucketName,
          OUTPUT_BUCKET: props.bucket.bucketName,
          MEETINGS_TABLE_NAME: props.meetingsTable.tableName,
          MEDIACONVERT_ROLE_ARN: mediaConvertRole.roleArn,
          MEDIACONVERT_QUEUE_ARN: `arn:aws:mediaconvert:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:queues/Default`,
        },
      }
    );

    // 2. Processing Status Monitor
    const processingStatusMonitor = new cdk.aws_lambda.Function(
      this,
      "ProcessingStatusMonitor",
      {
        runtime: cdk.aws_lambda.Runtime.PYTHON_3_12,
        code: cdk.aws_lambda.Code.fromAsset(
          "../meeting-processor-cdk/lambda/src/verify_s3_file"
        ),
        handler: "handler.lambda_handler",
        timeout: cdk.Duration.minutes(5),
        memorySize: 512,
        environment: {
          BUCKET_NAME: props.bucket.bucketName,
          MEETINGS_TABLE_NAME: props.meetingsTable.tableName,
        },
      }
    );

    // 3. AI Meeting Analyzer - Database-driven configuration
    const aiMeetingAnalyzer = new cdk.aws_lambda.Function(
      this,
      "AiMeetingAnalyzer",
      {
        runtime: cdk.aws_lambda.Runtime.PYTHON_3_12,
        code: cdk.aws_lambda.Code.fromAsset(
          "../meeting-processor-cdk/lambda/src/process_transcript",
          {
            bundling: {
              image: cdk.aws_lambda.Runtime.PYTHON_3_12.bundlingImage,
              command: [
                "bash",
                "-c",
                // x86_64 wheels to match the Lambda, whatever CPU builds this (Apple Silicon Docker is arm64)
                "pip install -r requirements.txt -t /asset-output --platform manylinux2014_x86_64 --implementation cp --python-version 3.12 --only-binary=:all: && cp -au . /asset-output",
              ],
            },
          }
        ),
        handler: "handler.lambda_handler",
        timeout: cdk.Duration.minutes(15),
        memorySize: 3008,
        environment: {
          S3_BUCKET: props.bucket.bucketName,
          MEETINGS_TABLE_NAME: props.meetingsTable.tableName,
          CLOUDFRONT_DOMAIN_NAME:
            props.videoDistribution.distributionDomainName,
          FRONTEND_DOMAIN_NAME:
            props.frontendDistribution.distributionDomainName,
          // AI model configuration. The fallback takes over on refusals and Bedrock outages.
          TRANSCRIPT_MODEL_ID: "us.anthropic.claude-sonnet-5",
          TRANSCRIPT_FALLBACK_MODEL_ID: "us.anthropic.claude-opus-4-8",
          TRANSCRIPT_MAX_TOKENS: "64000",
          TRANSCRIPT_EFFORT: "medium",
          TRANSCRIPT_PROMPT_TEMPLATE: transcriptPromptTemplate,
          FALLBACK_AGENDA_TEXT: fallbackAgendaText,
        },
      }
    );

    // 4. Document PDF Generator
    const documentPdfGenerator = new cdk.aws_lambda.Function(
      this,
      "DocumentPdfGenerator",
      {
        runtime: cdk.aws_lambda.Runtime.PYTHON_3_12,
        code: cdk.aws_lambda.Code.fromAsset(
          "../meeting-processor-cdk/lambda/src/html_to_pdf"
        ),
        handler: "handler.lambda_handler",
        timeout: cdk.Duration.minutes(5),
        memorySize: 1536,
        layers: [pdfGenerationLayer],
        environment: {
          BUCKET_NAME: props.bucket.bucketName,
          MEETINGS_TABLE_NAME: props.meetingsTable.tableName,
          LD_LIBRARY_PATH: "/opt/lib",
          FONTCONFIG_PATH: "/opt/fonts",
        },
      }
    );

    // 5. Notification Sender - Database-driven user notifications
    const notificationSender = new cdk.aws_lambda.Function(
      this,
      "NotificationSender",
      {
        runtime: cdk.aws_lambda.Runtime.PYTHON_3_12,
        code: cdk.aws_lambda.Code.fromAsset(
          "../meeting-processor-cdk/lambda/src/email_sender"
        ),
        handler: "handler.lambda_handler",
        timeout: cdk.Duration.minutes(1),
        memorySize: 256,
        environment: {
          MEETINGS_TABLE_NAME: props.meetingsTable.tableName,
          USER_PREFERENCES_TABLE_NAME: props.userPreferencesTable.tableName,
        },
      }
    );

    // =================================================================
    // IAM PERMISSIONS - Grant database and service access
    // =================================================================

    // S3 permissions for all functions
    props.bucket.grantReadWrite(videoToAudioConverter);
    props.bucket.grantReadWrite(processingStatusMonitor);
    props.bucket.grantReadWrite(aiMeetingAnalyzer);
    props.bucket.grantReadWrite(documentPdfGenerator);
    props.bucket.grantRead(notificationSender);

    // DynamoDB permissions
    props.meetingsTable.grantReadWriteData(videoToAudioConverter);
    props.meetingsTable.grantReadWriteData(processingStatusMonitor);
    props.meetingsTable.grantReadWriteData(aiMeetingAnalyzer);
    props.meetingsTable.grantReadWriteData(documentPdfGenerator);
    props.meetingsTable.grantReadData(notificationSender);

    props.userPreferencesTable.grantReadData(notificationSender);

    // SNS permissions for notification sender (to publish to user-specific topics)
    notificationSender.addToRolePolicy(
      new cdk.aws_iam.PolicyStatement({
        effect: cdk.aws_iam.Effect.ALLOW,
        actions: ["sns:Publish"],
        resources: ["arn:aws:sns:*:*:minute-maker-user-*"],
      })
    );

    // MediaConvert permissions - Full access for now
    videoToAudioConverter.addToRolePolicy(
      new cdk.aws_iam.PolicyStatement({
        effect: cdk.aws_iam.Effect.ALLOW,
        actions: ["mediaconvert:*"],
        resources: ["*"],
      })
    );

    // IAM PassRole permission for MediaConvert - Broader permission for now
    videoToAudioConverter.addToRolePolicy(
      new cdk.aws_iam.PolicyStatement({
        effect: cdk.aws_iam.Effect.ALLOW,
        actions: ["iam:PassRole"],
        resources: ["*"],
        conditions: {
          StringEquals: {
            "iam:PassedToService": "mediaconvert.amazonaws.com",
          },
        },
      })
    );

    // Bedrock permissions for AI functions - Full access for now
    [aiMeetingAnalyzer].forEach((func) => {
      func.addToRolePolicy(
        new cdk.aws_iam.PolicyStatement({
          effect: cdk.aws_iam.Effect.ALLOW,
          actions: ["bedrock:*"],
          resources: ["*"],
        })
      );
    });

    // Transcribe permissions for video and status monitor functions
    [videoToAudioConverter, processingStatusMonitor].forEach((func) => {
      func.addToRolePolicy(
        new cdk.aws_iam.PolicyStatement({
          effect: cdk.aws_iam.Effect.ALLOW,
          actions: ["transcribe:*"],
          resources: ["*"],
        })
      );
    });

    // MediaConvert permissions for status monitor (to check job status)
    processingStatusMonitor.addToRolePolicy(
      new cdk.aws_iam.PolicyStatement({
        effect: cdk.aws_iam.Effect.ALLOW,
        actions: ["mediaconvert:*"],
        resources: ["*"],
      })
    );

    // Transcribe permissions for Step Functions - Full access for now
    const transcribePermissions = new cdk.aws_iam.PolicyStatement({
      effect: cdk.aws_iam.Effect.ALLOW,
      actions: ["transcribe:*"],
      resources: ["*"],
    });

    // =================================================================
    // STEP FUNCTIONS STATE MACHINE - Meeting processing workflow
    // =================================================================

    // Read the state machine definition and replace placeholders
    let stateMachineDefinitionString = fs.readFileSync(
      path.join(
        __dirname,
        "../../meeting-processor-cdk/statemachine/transcribe.asl.json"
      ),
      "utf8"
    );

    // Replace placeholders with actual function ARNs
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
      .replace(/\$\{OutputBucketName\}/g, props.bucket.bucketName);

    const stateMachineDefinition =
      cdk.aws_stepfunctions.DefinitionBody.fromString(
        stateMachineDefinitionString
      );

    this.stateMachine = new cdk.aws_stepfunctions.StateMachine(
      this,
      "MeetingProcessingWorkflow",
      {
        definitionBody: stateMachineDefinition,
        timeout: cdk.Duration.hours(4),
      }
    );

    // Grant state machine permissions
    this.stateMachine.addToRolePolicy(transcribePermissions);
    this.stateMachine.addToRolePolicy(
      new cdk.aws_iam.PolicyStatement({
        effect: cdk.aws_iam.Effect.ALLOW,
        actions: ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"],
        resources: [`${props.bucket.bucketArn}/*`],
      })
    );

    // Grant Lambda invoke permissions to state machine
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
    // AGENDA PROCESSOR - Separate function for agenda document processing
    // =================================================================

    this.agendaProcessor = new cdk.aws_lambda.Function(
      this,
      "AgendaDocumentProcessor",
      {
        runtime: cdk.aws_lambda.Runtime.PYTHON_3_12,
        code: cdk.aws_lambda.Code.fromAsset(
          "../meeting-processor-cdk/lambda/src/agenda_processor",
          {
            bundling: {
              image: cdk.aws_lambda.Runtime.PYTHON_3_12.bundlingImage,
              command: [
                "bash",
                "-c",
                // x86_64 wheels to match the Lambda, whatever CPU builds this (Apple Silicon Docker is arm64)
                "pip install -r requirements.txt -t /asset-output --platform manylinux2014_x86_64 --implementation cp --python-version 3.12 --only-binary=:all: && cp -au . /asset-output",
              ],
            },
          }
        ),
        handler: "handler.lambda_handler",
        timeout: cdk.Duration.minutes(15),
        memorySize: 1024,
        environment: {
          BUCKET_NAME: props.bucket.bucketName,
          MEETINGS_TABLE_NAME: props.meetingsTable.tableName,
          // AI model configuration. The fallback takes over on refusals and Bedrock outages.
          AGENDA_MODEL_ID: "us.anthropic.claude-sonnet-5",
          AGENDA_FALLBACK_MODEL_ID: "us.anthropic.claude-opus-4-8",
          AGENDA_MAX_TOKENS: "64000",
          AGENDA_EFFORT: "medium",
        },
      }
    );

    // Permissions for agenda processor
    props.bucket.grantReadWrite(this.agendaProcessor);
    props.meetingsTable.grantReadWriteData(this.agendaProcessor);

    // Textract permissions for agenda processor - Full access for now
    this.agendaProcessor.addToRolePolicy(
      new cdk.aws_iam.PolicyStatement({
        effect: cdk.aws_iam.Effect.ALLOW,
        actions: ["textract:*"],
        resources: ["*"],
      })
    );

    // Bedrock permissions for agenda processor - Full access for now
    this.agendaProcessor.addToRolePolicy(
      new cdk.aws_iam.PolicyStatement({
        effect: cdk.aws_iam.Effect.ALLOW,
        actions: ["bedrock:*"],
        resources: ["*"],
      })
    );

    // STS permissions for agenda processor
    this.agendaProcessor.addToRolePolicy(
      new cdk.aws_iam.PolicyStatement({
        effect: cdk.aws_iam.Effect.ALLOW,
        actions: ["sts:GetCallerIdentity"],
        resources: ["*"],
      })
    );

    // Note: Agenda processor no longer needs Step Functions permissions
    // It saves agenda data to S3 and lets the existing workflow find it
  }
}
