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
          // AI configuration now comes from database instead of hardcoded env vars
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

    // MediaConvert permissions
    videoToAudioConverter.addToRolePolicy(
      new cdk.aws_iam.PolicyStatement({
        effect: cdk.aws_iam.Effect.ALLOW,
        actions: [
          "mediaconvert:CreateJob",
          "mediaconvert:GetJob",
          "mediaconvert:ListJobs",
          "mediaconvert:DescribeEndpoints",
        ],
        resources: ["*"],
      })
    );

    // Bedrock permissions for AI functions
    [aiMeetingAnalyzer].forEach((func) => {
      func.addToRolePolicy(
        new cdk.aws_iam.PolicyStatement({
          effect: cdk.aws_iam.Effect.ALLOW,
          actions: [
            "bedrock:InvokeModel",
            "bedrock:InvokeModelWithResponseStream",
          ],
          resources: [
            // Claude models for transcript analysis
            "arn:aws:bedrock:us-west-2::foundation-model/anthropic.claude-3-7-sonnet-*",
            "arn:aws:bedrock:us-east-1::foundation-model/anthropic.claude-3-7-sonnet-*",
            // Nova models for agenda analysis
            "arn:aws:bedrock:us-east-1::foundation-model/amazon.nova-premier-v1:0",
            "arn:aws:bedrock:us-west-2::foundation-model/amazon.nova-premier-v1:0",
          ],
        })
      );
    });

    // Transcribe permissions for Step Functions
    const transcribePermissions = new cdk.aws_iam.PolicyStatement({
      effect: cdk.aws_iam.Effect.ALLOW,
      actions: [
        "transcribe:StartTranscriptionJob",
        "transcribe:GetTranscriptionJob",
        "transcribe:ListTranscriptionJobs",
      ],
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

    // Textract permissions for agenda processor
    this.agendaProcessor.addToRolePolicy(
      new cdk.aws_iam.PolicyStatement({
        effect: cdk.aws_iam.Effect.ALLOW,
        actions: [
          "textract:StartDocumentAnalysis",
          "textract:GetDocumentAnalysis",
        ],
        resources: ["*"],
      })
    );

    // Bedrock permissions for agenda processor
    this.agendaProcessor.addToRolePolicy(
      new cdk.aws_iam.PolicyStatement({
        effect: cdk.aws_iam.Effect.ALLOW,
        actions: ["bedrock:InvokeModel", "bedrock:Converse"],
        resources: [
          "arn:aws:bedrock:us-east-1::foundation-model/amazon.nova-premier-v1:0",
          "arn:aws:bedrock:us-west-2::foundation-model/amazon.nova-premier-v1:0",
          "arn:aws:bedrock:us-east-1::foundation-model/us.anthropic.claude-sonnet-4-*",
          "arn:aws:bedrock:us-west-2::foundation-model/us.anthropic.claude-sonnet-4-*",
        ],
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
