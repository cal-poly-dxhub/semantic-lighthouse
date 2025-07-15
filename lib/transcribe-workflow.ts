import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";

export interface TranscribeWorkflowProps {
  uniquePrefix: string;
  outputBucket: cdk.aws_s3.Bucket;
  mediaConvertLambda: cdk.aws_lambda.Function;
  verifyS3FileLambda: cdk.aws_lambda.Function;
  processTranscriptLambda: cdk.aws_lambda.Function;
  htmlToPdfLambda: cdk.aws_lambda.Function;
  emailSenderLambda: cdk.aws_lambda.Function;
}

export class TranscribeWorkflowResources extends Construct {
  public readonly stateMachine: cdk.aws_stepfunctions.StateMachine;

  constructor(scope: Construct, id: string, props: TranscribeWorkflowProps) {
    super(scope, id);

    const {
      uniquePrefix,
      outputBucket,
      mediaConvertLambda,
      verifyS3FileLambda,
      processTranscriptLambda,
      htmlToPdfLambda,
      emailSenderLambda,
    } = props;

    const definition = this.createDefinition(
      outputBucket,
      mediaConvertLambda,
      verifyS3FileLambda,
      processTranscriptLambda,
      htmlToPdfLambda,
      emailSenderLambda
    );

    this.stateMachine = new cdk.aws_stepfunctions.StateMachine(
      this,
      "TranscribeStateMachine",
      {
        stateMachineName: `${uniquePrefix}-transcribe-workflow`,
        definition,
        timeout: cdk.Duration.hours(2),
      }
    );

    this.grantPermissions(outputBucket);
  }

  private createDefinition(
    outputBucket: cdk.aws_s3.Bucket,
    mediaConvertLambda: cdk.aws_lambda.Function,
    verifyS3FileLambda: cdk.aws_lambda.Function,
    processTranscriptLambda: cdk.aws_lambda.Function,
    htmlToPdfLambda: cdk.aws_lambda.Function,
    emailSenderLambda: cdk.aws_lambda.Function
  ): cdk.aws_stepfunctions.IChainable {
    const processWithMediaConvert =
      new cdk.aws_stepfunctions_tasks.LambdaInvoke(
        this,
        "ProcessWithMediaConvert",
        {
          lambdaFunction: mediaConvertLambda,
          payload: cdk.aws_stepfunctions.TaskInput.fromObject({
            "inputBucket.$": "$.detail.bucket.name",
            "inputKey.$": "$.detail.object.key",
            outputBucket: outputBucket.bucketName,
            outputKeyPrefix: "converted/",
          }),
          resultPath: "$.mediaConvertResult",
        }
      )
        .addRetry({
          errors: ["States.TaskFailed"],
          interval: cdk.Duration.seconds(30),
          maxAttempts: 3,
          backoffRate: 2,
        })
        .addCatch(this.fail("MediaConvertFailed", "MediaConvert Job Failed"));

    const waitForMediaConvert = new cdk.aws_stepfunctions.Wait(
      this,
      "WaitForMediaConvert",
      {
        time: cdk.aws_stepfunctions.WaitTime.duration(
          cdk.Duration.seconds(120)
        ),
      }
    );

    const checkMediaConvertJobs = new cdk.aws_stepfunctions_tasks.LambdaInvoke(
      this,
      "CheckAllMediaConvertJobsWithLambda",
      {
        lambdaFunction: verifyS3FileLambda,
        payload: cdk.aws_stepfunctions.TaskInput.fromObject({
          "job_ids.$": "$.mediaConvertResult.Payload.job_ids",
        }),
        resultPath: "$.mediaConvertJobsCheck",
      }
    )
      .addRetry({
        errors: ["States.TaskFailed"],
        interval: cdk.Duration.seconds(30),
        maxAttempts: 3,
        backoffRate: 2,
      })
      .addCatch(this.fail("MediaConvertFailed4", "MediaConvert Job Failed"));

    const waitLongerForMediaConvert = new cdk.aws_stepfunctions.Wait(
      this,
      "WaitLongerForMediaConvert",
      {
        time: cdk.aws_stepfunctions.WaitTime.duration(
          cdk.Duration.seconds(180)
        ),
      }
    );

    const audioVerificationMap =
      this.createAudioVerificationMap(verifyS3FileLambda);
    const transcriptionMap = this.createTranscriptionMap(outputBucket);
    const agendaCheckChain = this.createAgendaCheckChain(verifyS3FileLambda);

    const processAllTranscripts = new cdk.aws_stepfunctions_tasks.LambdaInvoke(
      this,
      "ProcessAllTranscripts",
      {
        lambdaFunction: processTranscriptLambda,
        payload: cdk.aws_stepfunctions.TaskInput.fromObject({
          "transcriptionResults.$": "$.transcriptionResults",
          "mediaConvertResult.$": "$.mediaConvertResult",
          originalVideoInfo: {
            "bucket.$": "$.detail.bucket.name",
            "key.$": "$.detail.object.key",
          },
          isChunkedProcessing: true,
          "agendaData.$": "$.agendaCheck.Payload",
        }),
        resultPath: "$.processResult",
      }
    ).addCatch(
      this.fail("TranscriptionProcessingFailed", "Transcript Processing Failed")
    );

    const convertHtmlToPdf = new cdk.aws_stepfunctions_tasks.LambdaInvoke(
      this,
      "ConvertHtmlToPdf",
      {
        lambdaFunction: htmlToPdfLambda,
        payload: cdk.aws_stepfunctions.TaskInput.fromObject({
          "htmlS3Uri.$": "$.processResult.Payload.htmlS3Uri",
          "outputFileName.$": "$.detail.object.key",
          "originalVideoInfo.$": "$.detail",
        }),
        resultPath: "$.convertPdfResult",
      }
    )
      .addRetry({
        errors: ["States.TaskFailed"],
        interval: cdk.Duration.seconds(30),
        maxAttempts: 3,
        backoffRate: 2,
      })
      .addCatch(
        this.fail(
          "TranscriptionProcessingFailed2",
          "Transcript Processing Failed"
        )
      );

    const sendEmailNotification = new cdk.aws_stepfunctions_tasks.LambdaInvoke(
      this,
      "SendEmailNotification",
      {
        lambdaFunction: emailSenderLambda,
        payload: cdk.aws_stepfunctions.TaskInput.fromObject({
          "htmlS3Uri.$": "$.processResult.Payload.htmlS3Uri",
          "pdfS3Uri.$": "$.convertPdfResult.Payload.pdfS3Uri",
          "originalFileName.$": "$.detail.object.key",
        }),
        resultPath: "$.emailResult",
      }
    )
      .addRetry({
        errors: ["States.TaskFailed"],
        interval: cdk.Duration.seconds(30),
        maxAttempts: 3,
        backoffRate: 2,
      })
      .addCatch(
        this.fail("EmailNotificationFailed", "Email Notification Failed")
      );

    // Build the flow
    const checkJobCount = new cdk.aws_stepfunctions.Choice(
      this,
      "CheckJobCount"
    )
      .when(
        cdk.aws_stepfunctions.Condition.isPresent(
          "$.mediaConvertResult.Payload.job_ids"
        ),
        new cdk.aws_stepfunctions.Choice(this, "HasJobs")
          .when(
            cdk.aws_stepfunctions.Condition.and(
              cdk.aws_stepfunctions.Condition.isPresent(
                "$.mediaConvertResult.Payload.job_ids"
              ),
              cdk.aws_stepfunctions.Condition.isPresent(
                "$.mediaConvertResult.Payload.job_ids[0]"
              )
            ),
            waitForMediaConvert
          )
          .otherwise(
            this.fail("MediaConvertFailed2", "MediaConvert Job Failed")
          )
      )
      .otherwise(this.fail("MediaConvertFailed3", "MediaConvert Job Failed"));

    const evaluateMediaConvertResults = new cdk.aws_stepfunctions.Choice(
      this,
      "EvaluateMediaConvertResults"
    )
      .when(
        cdk.aws_stepfunctions.Condition.booleanEquals(
          "$.mediaConvertJobsCheck.Payload.anyFailed",
          true
        ),
        this.fail("MediaConvertFailed5", "MediaConvert Job Failed")
      )
      .when(
        cdk.aws_stepfunctions.Condition.booleanEquals(
          "$.mediaConvertJobsCheck.Payload.allComplete",
          true
        ),
        audioVerificationMap
      )
      .otherwise(waitLongerForMediaConvert);

    // Connect the states
    waitForMediaConvert.next(checkMediaConvertJobs);
    checkMediaConvertJobs.next(evaluateMediaConvertResults);
    waitLongerForMediaConvert.next(checkMediaConvertJobs);
    audioVerificationMap.next(transcriptionMap);
    transcriptionMap.next(agendaCheckChain);
    // Add processAllTranscripts.next(convertHtmlToPdf) to connect the states
    processAllTranscripts.next(convertHtmlToPdf);
    convertHtmlToPdf.next(sendEmailNotification);

    return processWithMediaConvert.next(checkJobCount);
  }

  private createAudioVerificationMap(
    verifyS3FileLambda: cdk.aws_lambda.Function
  ): cdk.aws_stepfunctions.Map {
    const verifySingleAudioFile = new cdk.aws_stepfunctions_tasks.LambdaInvoke(
      this,
      "VerifySingleAudioFile",
      {
        lambdaFunction: verifyS3FileLambda,
        payload: cdk.aws_stepfunctions.TaskInput.fromObject({
          "s3_uri.$": "$",
        }),
      }
    ).addRetry({
      errors: ["States.TaskFailed"],
      interval: cdk.Duration.seconds(15),
      maxAttempts: 8,
      backoffRate: 2,
    });

    const checkAudioExists = new cdk.aws_stepfunctions.Choice(
      this,
      "CheckAudioExists"
    )
      .when(
        cdk.aws_stepfunctions.Condition.booleanEquals("$.Payload.exists", true),
        new cdk.aws_stepfunctions.Pass(this, "AudioExists", {
          result: cdk.aws_stepfunctions.Result.fromObject({ status: "EXISTS" }),
        })
      )
      .otherwise(this.fail("AudioMissing", "Audio File Not Found"));

    return new cdk.aws_stepfunctions.Map(this, "VerifyAllAudioFiles", {
      itemsPath: cdk.aws_stepfunctions.JsonPath.stringAt(
        "$.mediaConvertResult.Payload.audioOutputUris"
      ),
      maxConcurrency: 5,
      resultPath: "$.audioVerificationResults",
    })
      .itemProcessor(verifySingleAudioFile.next(checkAudioExists))
      .addCatch(this.fail("AudioFileNotFound", "Audio File Not Found"));
  }

  private createTranscriptionMap(
    outputBucket: cdk.aws_s3.Bucket
  ): cdk.aws_stepfunctions.Map {
    const startTranscriptionJob =
      new cdk.aws_stepfunctions_tasks.CallAwsService(
        this,
        "StartSingleTranscriptionJob",
        {
          service: "transcribe",
          action: "startTranscriptionJob",
          parameters: {
            LanguageCode: "en-US",
            Media: {
              "MediaFileUri.$": "$",
            },
            "TranscriptionJobName.$":
              "States.Format('transcribe-{}-{}', $$.Execution.Name, States.UUID())",
            OutputBucketName: outputBucket.bucketName,
            OutputKey: "transcripts/",
            Settings: {
              ShowSpeakerLabels: true,
              MaxSpeakerLabels: 10,
            },
          },
          iamResources: ["*"],
        }
      ).addRetry({
        errors: ["States.TaskFailed"],
        interval: cdk.Duration.seconds(30),
        maxAttempts: 3,
        backoffRate: 2,
      });

    const waitForTranscription = new cdk.aws_stepfunctions.Wait(
      this,
      "WaitForSingleTranscription",
      {
        time: cdk.aws_stepfunctions.WaitTime.duration(cdk.Duration.seconds(60)),
      }
    );

    const getTranscriptionStatus =
      new cdk.aws_stepfunctions_tasks.CallAwsService(
        this,
        "GetSingleTranscriptionStatus",
        {
          service: "transcribe",
          action: "getTranscriptionJob",
          parameters: {
            "TranscriptionJobName.$": "$.TranscriptionJob.TranscriptionJobName",
          },
          iamResources: ["*"],
        }
      );

    const checkTranscriptionStatus = new cdk.aws_stepfunctions.Choice(
      this,
      "CheckTranscriptionStatus"
    )
      .when(
        cdk.aws_stepfunctions.Condition.stringEquals(
          "$.TranscriptionJob.TranscriptionJobStatus",
          "COMPLETED"
        ),
        new cdk.aws_stepfunctions.Pass(this, "TranscriptionComplete")
      )
      .when(
        cdk.aws_stepfunctions.Condition.stringEquals(
          "$.TranscriptionJob.TranscriptionJobStatus",
          "FAILED"
        ),
        this.fail("TranscriptionJobFailed", "Transcription Job Failed")
      )
      .otherwise(waitForTranscription);

    waitForTranscription.next(getTranscriptionStatus);
    getTranscriptionStatus.next(checkTranscriptionStatus);

    return new cdk.aws_stepfunctions.Map(this, "StartAllTranscriptionJobs", {
      itemsPath: cdk.aws_stepfunctions.JsonPath.stringAt(
        "$.mediaConvertResult.Payload.audioOutputUris"
      ),
      maxConcurrency: 5,
      resultPath: "$.transcriptionResults",
    })
      .itemProcessor(startTranscriptionJob.next(waitForTranscription))
      .addCatch(this.fail("TranscriptionFailed", "Transcription Job Failed"));
  }

  private createAgendaCheckChain(
    verifyS3FileLambda: cdk.aws_lambda.Function
  ): cdk.aws_stepfunctions.IChainable {
    const checkForAgenda = new cdk.aws_stepfunctions_tasks.LambdaInvoke(
      this,
      "CheckForAgenda",
      {
        lambdaFunction: verifyS3FileLambda,
        payload: cdk.aws_stepfunctions.TaskInput.fromObject({
          check_agenda: true,
          "video_s3_key.$": "$.detail.object.key",
        }),
        resultPath: "$.agendaCheck",
      }
    ).addRetry({
      errors: ["States.TaskFailed"],
      interval: cdk.Duration.seconds(10),
      maxAttempts: 2,
      backoffRate: 2,
    });

    const hasAgenda = new cdk.aws_stepfunctions.Choice(this, "HasAgenda")
      .when(
        cdk.aws_stepfunctions.Condition.booleanEquals(
          "$.agendaCheck.Payload.agenda_exists",
          true
        ),
        new cdk.aws_stepfunctions.Pass(this, "AgendaFound")
      )
      .otherwise(new cdk.aws_stepfunctions.Pass(this, "ProceedWithoutAgenda"));

    return checkForAgenda.next(hasAgenda);
  }

  private fail(id: string, cause: string): cdk.aws_stepfunctions.Fail {
    return new cdk.aws_stepfunctions.Fail(this, id, {
      cause,
      error: cause,
    });
  }

  private grantPermissions(outputBucket: cdk.aws_s3.Bucket): void {
    this.stateMachine.addToRolePolicy(
      new cdk.aws_iam.PolicyStatement({
        effect: cdk.aws_iam.Effect.ALLOW,
        actions: [
          "transcribe:StartTranscriptionJob",
          "transcribe:GetTranscriptionJob",
          "lambda:InvokeFunction",
        ],
        resources: ["*"],
      })
    );

    // Grant Transcribe service access to S3 bucket
    this.stateMachine.addToRolePolicy(
      new cdk.aws_iam.PolicyStatement({
        effect: cdk.aws_iam.Effect.ALLOW,
        actions: [
          "s3:GetObject",
          "s3:PutObject",
          "s3:GetBucketLocation",
          "s3:ListBucket",
        ],
        resources: [outputBucket.bucketArn, `${outputBucket.bucketArn}/*`],
      })
    );
  }
}
