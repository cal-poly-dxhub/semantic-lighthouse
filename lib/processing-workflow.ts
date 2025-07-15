import * as cdk from "aws-cdk-lib";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as stepfunctions from "aws-cdk-lib/aws-stepfunctions";
import { Construct } from "constructs";
import { ProcessingFunctions } from "./processing-functions";
import { TranscribeWorkflowResources } from "./transcribe-workflow";

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

    const transcribeWorkflow = new TranscribeWorkflowResources(this, "TranscribeWorkflow", {
      uniquePrefix,
      outputBucket: meetingsBucket,
      mediaConvertLambda: processingFunctions.videoToAudioConverter,
      verifyS3FileLambda: processingFunctions.processingStatusMonitor,
      processTranscriptLambda: processingFunctions.aiMeetingAnalyzer,
      htmlToPdfLambda: processingFunctions.documentPdfGenerator,
      emailSenderLambda: processingFunctions.notificationSender,
    });

    this.stateMachine = transcribeWorkflow.stateMachine;
  }


}