import * as cdk from "aws-cdk-lib";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as stepfunctions from "aws-cdk-lib/aws-stepfunctions";
import * as iam from "aws-cdk-lib/aws-iam";
import * as fs from "fs";
import { Construct } from "constructs";
import { ProcessingFunctions } from "./processing-functions";

export interface ProcessingWorkflowProps {
  uniquePrefix: string;
  meetingsBucket: s3.Bucket;
  processingFunctions: ProcessingFunctions;
}

export class ProcessingWorkflowResources extends Construct {
  public readonly stateMachine: stepfunctions.StateMachine;

  constructor(scope: Construct, id: string, props: ProcessingWorkflowProps) {
    super(scope, id);

    const { uniquePrefix, meetingsBucket, processingFunctions } = props;

    // Read the state machine definition and substitute variables
    let stateMachineDefinitionString = fs.readFileSync(
      "statemachine/transcribe.asl.json",
      "utf8"
    );

    // Replace placeholders with actual ARNs and values
    stateMachineDefinitionString = stateMachineDefinitionString
      .replace(/\$\{MediaConvertLambdaArn\}/g, processingFunctions.videoToAudioConverter.functionArn)
      .replace(/\$\{VerifyS3FileLambdaArn\}/g, processingFunctions.processingStatusMonitor.functionArn)
      .replace(/\$\{ProcessTranscriptLambdaArn\}/g, processingFunctions.aiMeetingAnalyzer.functionArn)
      .replace(/\$\{HtmlToPdfFunctionArn\}/g, processingFunctions.documentPdfGenerator.functionArn)
      .replace(/\$\{EmailSenderLambdaArn\}/g, processingFunctions.notificationSender.functionArn)
      .replace(/\$\{OutputBucketName\}/g, meetingsBucket.bucketName);

    const stateMachineDefinition = stepfunctions.DefinitionBody.fromString(
      stateMachineDefinitionString
    );

    this.stateMachine = new stepfunctions.StateMachine(this, "MeetingProcessingWorkflow", {
      stateMachineName: `${uniquePrefix}-processing-workflow`,
      definitionBody: stateMachineDefinition,
      timeout: cdk.Duration.hours(4),
    });

    // Grant permissions
    this.grantPermissions(meetingsBucket, processingFunctions);
  }

  private grantPermissions(meetingsBucket: s3.Bucket, processingFunctions: ProcessingFunctions) {
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

    // Add S3 permissions to Step Functions state machine role
    this.stateMachine.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"],
        resources: [`${meetingsBucket.bucketArn}/*`],
      })
    );

    // Grant state machine permissions to invoke Lambda functions
    Object.values(processingFunctions).forEach((func) => {
      func.grantInvoke(this.stateMachine);
    });
  }
}