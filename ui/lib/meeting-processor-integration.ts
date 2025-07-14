import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as path from "path";
import * as fs from "fs";

export interface MeetingProcessorIntegrationProps {
  uniqueId: string;
  bucket: cdk.aws_s3.Bucket;
  meetingsTable: cdk.aws_dynamodb.Table;
  userPreferencesTable: cdk.aws_dynamodb.Table;
  systemConfigTable: cdk.aws_dynamodb.Table;
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

    const timestamp = Math.floor(Date.now() / 1000)
      .toString()
      .slice(-6);
    const uniquePrefix =
      `semantic-lighthouse-${props.uniqueId}-${timestamp}`.toLowerCase();

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
    // AI CONFIGURATION - Hardcoded in database via custom resource
    // =================================================================
    this.populateAIConfiguration(props.systemConfigTable);

    // =================================================================
    // LAMBDA LAYERS - Required for video processing and PDF generation
    // =================================================================

    // Video analysis layer with pymediainfo
    const videoAnalysisLayer = new cdk.aws_lambda.LayerVersion(
      this,
      "VideoAnalysisLayer",
      {
        layerVersionName: `${uniquePrefix}-video-analysis`,
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
        layerVersionName: `${uniquePrefix}-pdf-generation-tools`,
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
        roleName: `${uniquePrefix}-mediaconvert-service-role`,
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
        functionName: `${uniquePrefix}-video-to-audio-converter`,
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
          SYSTEM_CONFIG_TABLE_NAME: props.systemConfigTable.tableName,
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
        functionName: `${uniquePrefix}-processing-status-monitor`,
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
        functionName: `${uniquePrefix}-ai-meeting-analyzer`,
        runtime: cdk.aws_lambda.Runtime.PYTHON_3_12,
        code: cdk.aws_lambda.Code.fromAsset(
          "../meeting-processor-cdk/lambda/src/process_transcript",
          {
            bundling: {
              image: cdk.aws_lambda.Runtime.PYTHON_3_12.bundlingImage,
              command: [
                "bash",
                "-c",
                "pip install -r requirements.txt -t /asset-output && cp -au . /asset-output",
              ],
            },
          }
        ),
        handler: "handler.lambda_handler",
        timeout: cdk.Duration.minutes(15),
        memorySize: 4096,
        environment: {
          S3_BUCKET: props.bucket.bucketName,
          MEETINGS_TABLE_NAME: props.meetingsTable.tableName,
          SYSTEM_CONFIG_TABLE_NAME: props.systemConfigTable.tableName,
          CLOUDFRONT_DOMAIN_NAME:
            props.videoDistribution.distributionDomainName,
          FRONTEND_DOMAIN_NAME:
            props.frontendDistribution.distributionDomainName,
          // AI model configuration
          TRANSCRIPT_MODEL_ID: "us.anthropic.claude-3-7-sonnet-20250219-v1:0",
          TRANSCRIPT_MAX_TOKENS: "8000",
          TRANSCRIPT_TEMPERATURE: "0.2",
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
        functionName: `${uniquePrefix}-document-pdf-generator`,
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
        functionName: `${uniquePrefix}-notification-sender`,
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

    props.systemConfigTable.grantReadData(videoToAudioConverter);
    props.systemConfigTable.grantReadData(aiMeetingAnalyzer);

    props.userPreferencesTable.grantReadData(notificationSender);

    // SNS permissions for notification sender (to publish to user-specific topics)
    notificationSender.addToRolePolicy(
      new cdk.aws_iam.PolicyStatement({
        effect: cdk.aws_iam.Effect.ALLOW,
        actions: ["sns:Publish"],
        resources: ["arn:aws:sns:*:*:semantic-lighthouse-user-*"],
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
        stateMachineName: `${uniquePrefix}-processing-workflow`,
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
        functionName: `${uniquePrefix}-agenda-document-processor`,
        runtime: cdk.aws_lambda.Runtime.PYTHON_3_12,
        code: cdk.aws_lambda.Code.fromAsset(
          "../meeting-processor-cdk/lambda/src/agenda_processor"
        ),
        handler: "handler.lambda_handler",
        timeout: cdk.Duration.minutes(15),
        memorySize: 1024,
        environment: {
          BUCKET_NAME: props.bucket.bucketName,
          STATE_MACHINE_ARN: this.stateMachine.stateMachineArn,
          MEETINGS_TABLE_NAME: props.meetingsTable.tableName,
          SYSTEM_CONFIG_TABLE_NAME: props.systemConfigTable.tableName,
        },
      }
    );

    // Permissions for agenda processor
    props.bucket.grantReadWrite(this.agendaProcessor);
    props.meetingsTable.grantReadWriteData(this.agendaProcessor);
    props.systemConfigTable.grantReadData(this.agendaProcessor);

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

    // Step Functions permissions for agenda processor
    this.agendaProcessor.addToRolePolicy(
      new cdk.aws_iam.PolicyStatement({
        effect: cdk.aws_iam.Effect.ALLOW,
        actions: ["states:StartExecution"],
        resources: [this.stateMachine.stateMachineArn],
      })
    );
  }

  /**
   * Populate AI configuration in database using a custom resource
   */
  private populateAIConfiguration(systemConfigTable: cdk.aws_dynamodb.Table) {
    const populateConfigLambda = new cdk.aws_lambda.Function(
      this,
      "PopulateAIConfigLambda",
      {
        runtime: cdk.aws_lambda.Runtime.NODEJS_LATEST,
        handler: "index.handler",
        timeout: cdk.Duration.minutes(2),
        code: cdk.aws_lambda.Code.fromInline(`
        const { DynamoDBClient, BatchWriteItemCommand } = require('@aws-sdk/client-dynamodb');
        const https = require('https');
        const url = require('url');
        
        const sendResponse = async (event, context, responseStatus, responseData = {}) => {
          const responseBody = JSON.stringify({
            Status: responseStatus,
            Reason: 'See CloudWatch Log Stream: ' + context.logStreamName,
            PhysicalResourceId: 'populate-ai-config',
            StackId: event.StackId,
            RequestId: event.RequestId,
            LogicalResourceId: event.LogicalResourceId,
            Data: responseData
          });
          
          const parsedUrl = url.parse(event.ResponseURL);
          const options = {
            hostname: parsedUrl.hostname,
            port: 443,
            path: parsedUrl.path,
            method: 'PUT',
            headers: {
              'content-type': '',
              'content-length': responseBody.length
            }
          };
          
          return new Promise((resolve, reject) => {
            const request = https.request(options, (response) => {
              console.log('Status code: ' + response.statusCode);
              console.log('Status message: ' + response.statusMessage);
              resolve();
            });
            
            request.on('error', (error) => {
              console.log('send(..) failed executing https.request(..): ' + error);
              reject(error);
            });
            
            request.write(responseBody);
            request.end();
          });
        };
        
        exports.handler = async (event, context) => {
          console.log('Event:', JSON.stringify(event));
          
          try {
            if (event.RequestType === 'Delete') {
              console.log('Delete request - no action needed');
              await sendResponse(event, context, 'SUCCESS');
              return;
            }
            
            const dynamodb = new DynamoDBClient({});
            const tableName = process.env.TABLE_NAME;
            
            const configItems = [
              // Transcript Analysis Configuration
              {
                configKey: 'transcript_model_id',
                configValue: 'us.anthropic.claude-3-7-sonnet-20250219-v1:0',
                description: 'AI model for transcript analysis',
                category: 'transcript_analysis'
              },
              {
                configKey: 'transcript_max_tokens',
                configValue: '8000',
                description: 'Maximum tokens for transcript analysis',
                category: 'transcript_analysis'
              },
              {
                configKey: 'transcript_temperature',
                configValue: '0.2',
                description: 'Temperature for transcript analysis',
                category: 'transcript_analysis'
              },
              
              // Agenda Analysis Configuration
              {
                configKey: 'agenda_model_id',
                configValue: 'us.anthropic.claude-sonnet-4-20250514-v1:0',
                description: 'AI model for agenda analysis',
                category: 'agenda_analysis'
              },
              {
                configKey: 'agenda_max_tokens',
                configValue: '65535',
                description: 'Maximum tokens for agenda analysis',
                category: 'agenda_analysis'
              },
              {
                configKey: 'agenda_temperature',
                configValue: '0.1',
                description: 'Temperature for agenda analysis',
                category: 'agenda_analysis'
              },
              
              // Video Processing Configuration
              {
                configKey: 'video_chunk_duration_hours',
                configValue: '4',
                description: 'Duration threshold for video chunking',
                category: 'video_processing'
              },
              {
                configKey: 'mediaconvert_queue',
                configValue: 'Default',
                description: 'MediaConvert queue name',
                category: 'video_processing'
              },
              
              // Email Configuration
              {
                configKey: 'presigned_url_expiration_days',
                configValue: '7',
                description: 'Presigned URL expiration in days',
                category: 'email_notifications'
              }
            ];
            
            // Create batch write items
            const requests = configItems.map(item => ({
              PutRequest: {
                Item: {
                  configKey: { S: item.configKey },
                  configValue: { S: item.configValue },
                  description: { S: item.description },
                  category: { S: item.category },
                  createdAt: { S: new Date().toISOString() },
                  updatedAt: { S: new Date().toISOString() }
                }
              }
            }));
            
            // Write items in batches of 25 (DynamoDB limit)
            for (let i = 0; i < requests.length; i += 25) {
              const batch = requests.slice(i, i + 25);
              await dynamodb.send(new BatchWriteItemCommand({
                RequestItems: {
                  [tableName]: batch
                }
              }));
            }
            
            console.log('AI configuration populated successfully');
            await sendResponse(event, context, 'SUCCESS', { ItemsCreated: configItems.length });
            
          } catch (error) {
            console.error('Error populating AI config:', error);
            await sendResponse(event, context, 'FAILED', { Error: error.message });
          }
        };
      `),
        environment: {
          TABLE_NAME: systemConfigTable.tableName,
        },
      }
    );

    // Grant DynamoDB permissions
    systemConfigTable.grantWriteData(populateConfigLambda);

    // Create custom resource
    new cdk.CustomResource(this, "PopulateAIConfigResource", {
      serviceToken: populateConfigLambda.functionArn,
    });
  }
}
