import * as cdk from "aws-cdk-lib";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as stepfunctions from "aws-cdk-lib/aws-stepfunctions";
import * as iam from "aws-cdk-lib/aws-iam";
import { Construct } from "constructs";

export interface AgendaProcessorProps {
  uniquePrefix: string;
  meetingsBucket: s3.Bucket;
  stateMachine: stepfunctions.StateMachine;
}

export class AgendaProcessorResources extends Construct {
  public readonly agendaDocumentProcessor: lambda.Function;

  constructor(scope: Construct, id: string, props: AgendaProcessorProps) {
    super(scope, id);

    const { uniquePrefix, meetingsBucket, stateMachine } = props;

    // Create a dedicated IAM role with full Bedrock access
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

    this.agendaDocumentProcessor = new lambda.Function(
      this,
      "AgendaDocumentProcessor",
      {
        functionName: `${uniquePrefix}-agenda-document-processor`,
        runtime: lambda.Runtime.PYTHON_3_12,
        code: lambda.Code.fromAsset(
          "lambda/src/meeting-processor/agenda_processor"
        ),
        handler: "handler.lambda_handler",
        timeout: cdk.Duration.minutes(15),
        memorySize: 1024,
        role: agendaProcessorRole,
        environment: {
          BUCKET_NAME: meetingsBucket.bucketName,
          STATE_MACHINE_ARN: stateMachine.stateMachineArn,
          AGENDA_MODEL_ID: "us.anthropic.claude-sonnet-4-20250514-v1:0",
          AGENDA_MAX_TOKENS: "65535",
          AGENDA_TEMPERATURE: "0.1",
        },
      }
    );

    // Grant permissions
    this.grantPermissions(meetingsBucket, stateMachine);
  }

  private grantPermissions(
    meetingsBucket: s3.Bucket,
    stateMachine: stepfunctions.StateMachine
  ) {
    // S3 permissions
    meetingsBucket.grantReadWrite(this.agendaDocumentProcessor);

    // Textract permissions
    this.agendaDocumentProcessor.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          "textract:StartDocumentTextDetection",
          "textract:GetDocumentTextDetection",
        ],
        resources: ["*"],
      })
    );

    // Marketplace subscribe permissions
    this.agendaDocumentProcessor.addToRolePolicy(
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

    // Step Functions permissions
    this.agendaDocumentProcessor.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ["states:StartExecution"],
        resources: [stateMachine.stateMachineArn],
      })
    );

    // STS permissions
    this.agendaDocumentProcessor.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ["sts:GetCallerIdentity"],
        resources: ["*"],
      })
    );
  }
}
