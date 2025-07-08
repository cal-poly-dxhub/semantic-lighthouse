import * as cdk from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { MeetingProcessorCdkStack } from "../lib/meeting-processor-cdk-stack";

describe("MeetingProcessorCdkStack", () => {
  let app: cdk.App;
  let stack: MeetingProcessorCdkStack;
  let template: Template;

  beforeEach(() => {
    app = new cdk.App();
    stack = new MeetingProcessorCdkStack(app, "TestMeetingProcessorStack");
    template = Template.fromStack(stack);
  });

  test("S3 Bucket Created", () => {
    template.hasResourceProperties("AWS::S3::Bucket", {
      BucketEncryption: {
        ServerSideEncryptionConfiguration: [
          {
            ServerSideEncryptionByDefault: {
              SSEAlgorithm: "AES256",
            },
          },
        ],
      },
    });
  });

  test("SNS Topic Created", () => {
    template.hasResourceProperties("AWS::SNS::Topic", {
      TopicName: "meeting-processor-notifications",
    });
  });

  test("Lambda Functions Created", () => {
    // Check that all expected Lambda functions are created
    template.resourceCountIs("AWS::Lambda::Function", 7);

    // Verify specific functions exist
    template.hasResourceProperties("AWS::Lambda::Function", {
      FunctionName: "meeting-processor-mediaconvert-trigger-v2",
    });

    template.hasResourceProperties("AWS::Lambda::Function", {
      FunctionName: "meeting-processor-email-sender-v2",
    });

    template.hasResourceProperties("AWS::Lambda::Function", {
      FunctionName: "meeting-processor-agenda-processor-v2",
    });
  });

  test("Lambda Layers Created", () => {
    template.resourceCountIs("AWS::Lambda::LayerVersion", 2);

    template.hasResourceProperties("AWS::Lambda::LayerVersion", {
      LayerName: "pymediainfo-layer-v2",
    });

    template.hasResourceProperties("AWS::Lambda::LayerVersion", {
      LayerName: "weasyprint-layer-v2",
    });
  });

  test("Step Function State Machine Created", () => {
    template.hasResourceProperties("AWS::StepFunctions::StateMachine", {
      StateMachineName: "meeting-processor-transcription-v2",
    });
  });
});
