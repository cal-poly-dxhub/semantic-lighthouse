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
import { Construct } from "constructs";

export interface MeetingProcessorCdkStackProps extends cdk.StackProps {
  /**
   * The name of the S3 bucket for storing all meeting files.
   * @default 'meeting-minutes-processor-files-us-west-2-v2'
   */
  readonly s3BucketName?: string;
}

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

    // Default bucket name with -v2 suffix to avoid conflicts
    const bucketName =
      props.s3BucketName || "meeting-minutes-processor-files-us-west-2-v2";

    // =================================================================
    // S3 BUCKET - Central storage for all meeting files
    // =================================================================
    this.s3Bucket = new s3.Bucket(this, "MeetingFilesBucket", {
      bucketName: bucketName,
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
        topicName: "meeting-processor-notifications",
        displayName: "Meeting Processor Notifications",
      }
    );

    // =================================================================
    // LAMBDA LAYERS - WeasyPrint and MediaInfo
    // =================================================================

    // MediaInfo layer for video analysis
    const mediaInfoLayer = new lambda.LayerVersion(this, "MediaInfoLayer", {
      layerVersionName: "pymediainfo-layer-v2",
      code: lambda.Code.fromAsset(
        path.join(__dirname, "../lambda/layers/pymediainfo_layer")
      ),
      compatibleRuntimes: [lambda.Runtime.PYTHON_3_12],
      description: "PyMediaInfo library for video file analysis",
    });

    // WeasyPrint layer for PDF generation (precompiled with deps)
    const weasyPrintLayer = new lambda.LayerVersion(this, "WeasyPrintLayer", {
      layerVersionName: "weasyprint-layer-v2",
      code: lambda.Code.fromAsset(
        path.join(__dirname, "../lambda/layers/weasyprint")
      ),
      compatibleRuntimes: [lambda.Runtime.PYTHON_3_12],
      description: "WeasyPrint with native dependencies for HTML→PDF",
    });

    // =================================================================
    // LAMBDA FUNCTIONS - Meeting processing pipeline
    // =================================================================

    // 1. MediaConvert Trigger Function
    const mediaConvertTriggerFunction = new lambda.Function(
      this,
      "MediaConvertTriggerFunction",
      {
        functionName: "meeting-processor-mediaconvert-trigger-v2",
        runtime: lambda.Runtime.PYTHON_3_12,
        code: lambda.Code.fromAsset("lambda/src/mediaconvert_trigger"),
        handler: "handler.lambda_handler",
        timeout: cdk.Duration.minutes(15),
        memorySize: 2048,
        layers: [mediaInfoLayer],
        environment: {
          BUCKET_NAME: this.s3Bucket.bucketName,
          OUTPUT_BUCKET: this.s3Bucket.bucketName,
          ALLOWED_BUCKET_PATTERNS: JSON.stringify([
            "^k12-temp-testing-\\d+$",
            "^meeting-minutes-processor-files-.*$",
          ]),
        },
      }
    );

    // 2. Verify S3 File Function
    const verifyS3FileFunction = new lambda.Function(
      this,
      "VerifyS3FileFunction",
      {
        functionName: "meeting-processor-verify-s3-file-v2",
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

    // 3. Process Transcript Function
    const processTranscriptFunction = new lambda.Function(
      this,
      "ProcessTranscriptFunction",
      {
        functionName: "meeting-processor-process-transcript-v2",
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
        handler: "handler.handler",
        timeout: cdk.Duration.minutes(15),
        memorySize: 4096,
        environment: {
          S3_BUCKET: this.s3Bucket.bucketName,
        },
      }
    );

    // 4. HTML to PDF Function
    const htmlToPdfFunction = new lambda.Function(this, "HtmlToPdfFunction", {
      functionName: "meeting-processor-html-to-pdf-v2",
      runtime: lambda.Runtime.PYTHON_3_12,
      code: lambda.Code.fromAsset("lambda/src/html_to_pdf"),
      handler: "handler.lambda_handler",
      timeout: cdk.Duration.minutes(5),
      memorySize: 1536,
      layers: [weasyPrintLayer],
      environment: {
        BUCKET_NAME: this.s3Bucket.bucketName,
        LD_LIBRARY_PATH: "/opt/lib",
        FONTCONFIG_PATH: "/opt/fonts",
      },
    });

    // 5. Email Sender Function
    const emailSenderFunction = new lambda.Function(
      this,
      "EmailSenderFunction",
      {
        functionName: "meeting-processor-email-sender-v2",
        runtime: lambda.Runtime.PYTHON_3_12,
        code: lambda.Code.fromAsset("lambda/src/email_sender"),
        handler: "handler.lambda_handler",
        timeout: cdk.Duration.minutes(1),
        memorySize: 256,
        environment: {
          SNS_TOPIC_ARN: this.emailNotificationTopic.topicArn,
        },
      }
    );

    // =================================================================
    // IAM PERMISSIONS - Grant necessary permissions to Lambda functions
    // =================================================================

    // S3 permissions for all functions
    this.s3Bucket.grantReadWrite(mediaConvertTriggerFunction);
    this.s3Bucket.grantReadWrite(verifyS3FileFunction);
    this.s3Bucket.grantReadWrite(processTranscriptFunction);
    this.s3Bucket.grantReadWrite(htmlToPdfFunction);
    this.s3Bucket.grantRead(emailSenderFunction);

    // SNS permissions for email sender
    this.emailNotificationTopic.grantPublish(emailSenderFunction);

    // Allow EmailSenderFunction to read email.txt from external config bucket
    emailSenderFunction.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ["s3:GetObject"],
        resources: ["arn:aws:s3:::k12-temp-testing-static-files/*"],
      })
    );

    // Grant SNS subscribe and list permissions for confirmation flow
    emailSenderFunction.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ["sns:Subscribe", "sns:ListSubscriptionsByTopic"],
        resources: [this.emailNotificationTopic.topicArn],
      })
    );

    // MediaConvert permissions
    mediaConvertTriggerFunction.addToRolePolicy(
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
    mediaConvertTriggerFunction.addToRolePolicy(
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

    // MediaConvert permissions for VerifyS3FileFunction (to check job status)
    verifyS3FileFunction.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ["mediaconvert:GetJob", "mediaconvert:ListJobs"],
        resources: ["*"],
      })
    );

    // Transcribe permissions
    [mediaConvertTriggerFunction, verifyS3FileFunction].forEach((func) => {
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
    processTranscriptFunction.addToRolePolicy(
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

    // Allow ProcessTranscriptFunction to read external prompt and agenda files
    processTranscriptFunction.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ["s3:GetObject"],
        resources: ["arn:aws:s3:::k12-temp-testing-static-files/*"],
      })
    );

    // =================================================================
    // STEP FUNCTIONS STATE MACHINE - Main workflow orchestration
    // =================================================================

    // Read the state machine definition and substitute variables
    const fs = require("fs");
    let stateMachineDefinitionString = fs.readFileSync(
      "statemachine/transcribe.asl.json",
      "utf8"
    );

    // Replace placeholders with actual ARNs and values
    stateMachineDefinitionString = stateMachineDefinitionString
      .replace(
        /\$\{MediaConvertLambdaArn\}/g,
        mediaConvertTriggerFunction.functionArn
      )
      .replace(/\$\{VerifyS3FileLambdaArn\}/g, verifyS3FileFunction.functionArn)
      .replace(
        /\$\{ProcessTranscriptLambdaArn\}/g,
        processTranscriptFunction.functionArn
      )
      .replace(/\$\{HtmlToPdfFunctionArn\}/g, htmlToPdfFunction.functionArn)
      .replace(/\$\{EmailSenderLambdaArn\}/g, emailSenderFunction.functionArn)
      .replace(/\$\{OutputBucketName\}/g, this.s3Bucket.bucketName);

    const stateMachineDefinition = stepfunctions.DefinitionBody.fromString(
      stateMachineDefinitionString
    );

    this.stateMachine = new stepfunctions.StateMachine(
      this,
      "TranscriptionStateMachine",
      {
        stateMachineName: "meeting-processor-transcription-v2",
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
      mediaConvertTriggerFunction,
      verifyS3FileFunction,
      processTranscriptFunction,
      htmlToPdfFunction,
      emailSenderFunction,
    ].forEach((func) => {
      func.grantInvoke(this.stateMachine);
    });

    // =================================================================
    // AGENDA PROCESSOR FUNCTION - Created after state machine for ARN reference
    // =================================================================

    // Create a dedicated IAM role with full Bedrock access for the agenda processor
    const agendaProcessorRole = new iam.Role(this, "AgendaProcessorRole", {
      assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
      description:
        "Role for AgendaProcessor Lambda with full Amazon Bedrock access",
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          "service-role/AWSLambdaBasicExecutionRole"
        ),
        iam.ManagedPolicy.fromAwsManagedPolicyName("AmazonBedrockFullAccess"),
      ],
    });

    // 6. Agenda Processor Function
    const agendaProcessorFunction = new lambda.Function(
      this,
      "AgendaProcessorFunction",
      {
        functionName: "meeting-processor-agenda-processor-v2",
        runtime: lambda.Runtime.PYTHON_3_12,
        code: lambda.Code.fromAsset("lambda/src/agenda_processor"),
        handler: "handler.lambda_handler",
        timeout: cdk.Duration.minutes(15), // Maximum Lambda timeout
        memorySize: 1024,
        role: agendaProcessorRole,
        environment: {
          BUCKET_NAME: this.s3Bucket.bucketName,
          STATE_MACHINE_ARN: this.stateMachine.stateMachineArn,
          TEST_NOVA_ONLY: "false",
        },
      }
    );

    // Additional IAM permissions for AgendaProcessorFunction
    this.s3Bucket.grantReadWrite(agendaProcessorFunction);

    // Textract permissions for AgendaProcessorFunction
    agendaProcessorFunction.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          "textract:StartDocumentTextDetection",
          "textract:GetDocumentTextDetection",
        ],
        resources: ["*"],
      })
    );

    // Bedrock permissions for AgendaProcessorFunction (Nova Premier)
    agendaProcessorFunction.addToRolePolicy(
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
    agendaProcessorFunction.addToRolePolicy(
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

    // Step Functions permissions for AgendaProcessorFunction (to trigger combined processing)
    agendaProcessorFunction.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ["states:StartExecution"],
        resources: [this.stateMachine.stateMachineArn],
      })
    );

    // STS permissions for AgendaProcessorFunction (to get account ID)
    agendaProcessorFunction.addToRolePolicy(
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

    // Add Agenda Processor as target for agenda uploads
    s3AgendaUploadRule.addTarget(
      new targets.LambdaFunction(agendaProcessorFunction, {
        event: events.RuleTargetInput.fromEventPath("$"),
      })
    );

    // =================================================================
    // OUTPUTS - Export important ARNs and names
    // =================================================================

    new cdk.CfnOutput(this, "S3BucketName", {
      value: this.s3Bucket.bucketName,
      description: "S3 bucket for meeting files",
    });

    new cdk.CfnOutput(this, "StateMachineArn", {
      value: this.stateMachine.stateMachineArn,
      description: "Step Functions state machine ARN",
    });

    new cdk.CfnOutput(this, "EmailNotificationTopicArn", {
      value: this.emailNotificationTopic.topicArn,
      description: "SNS topic for email notifications",
    });

    new cdk.CfnOutput(this, "AgendaProcessorFunctionArn", {
      value: agendaProcessorFunction.functionArn,
      description: "Agenda processor Lambda function ARN",
    });
  }
}
