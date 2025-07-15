import * as cdk from "aws-cdk-lib";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as stepfunctions from "aws-cdk-lib/aws-stepfunctions";
import * as events from "aws-cdk-lib/aws-events";
import * as targets from "aws-cdk-lib/aws-events-targets";
import { Construct } from "constructs";

export interface ProcessingEventsProps {
  meetingsBucket: s3.Bucket;
  stateMachine: stepfunctions.StateMachine;
  agendaDocumentProcessor: lambda.Function;
}

export class ProcessingEventsResources extends Construct {
  constructor(scope: Construct, id: string, props: ProcessingEventsProps) {
    super(scope, id);

    const { meetingsBucket, stateMachine, agendaDocumentProcessor } = props;

    // EventBridge rule for video uploads
    const s3VideoUploadRule = new events.Rule(this, "S3VideoUploadRule", {
      eventPattern: {
        source: ["aws.s3"],
        detailType: ["Object Created"],
        detail: {
          bucket: {
            name: [meetingsBucket.bucketName],
          },
          object: {
            key: [{ suffix: "uploads/video.mp4" }],
          },
        },
      },
    });

    // Add Step Functions as target for video uploads
    s3VideoUploadRule.addTarget(
      new targets.SfnStateMachine(stateMachine, {
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
            name: [meetingsBucket.bucketName],
          },
          object: {
            key: [{ suffix: "uploads/agenda.pdf" }],
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
  }
}
