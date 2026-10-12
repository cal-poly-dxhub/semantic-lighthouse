"""What one meeting cost to process, at AWS list price, from what the run actually used.

    AWS_PROFILE=semlighthouse .venv/bin/python run-cost.py <meetingId>

Usage comes from the run itself: Bedrock tokens from the two AI Lambdas' logs, audio minutes
from the MediaConvert job (Transcribe bills the same audio), Textract pages from its job,
Lambda billed duration x memory from every function's REPORT lines, and Step Functions
transitions from the execution history. S3, DynamoDB, SNS, CloudFront and log storage are
fractions of a cent per meeting and left out. Free tier and credits are ignored, so this is
what an account without them would pay.
"""
import json
import re
import sys
from datetime import timedelta

import boto3

# us-west-2 on-demand list prices, from the AWS Pricing API (October 2026)
BEDROCK_PER_MILLION = {  # (input, output), US cross-region inference profiles
    "claude-sonnet-5": (2.20, 11.00),
    "claude-opus-4-8": (5.50, 27.50),
}
TRANSCRIBE_PER_SECOND = 0.0001
MEDIACONVERT_PER_MINUTE = 0.0075  # audio-only, basic tier
TEXTRACT_PER_PAGE = 0.0015  # DetectDocumentText
LAMBDA_PER_GB_SECOND = 0.0000166667
LAMBDA_PER_REQUEST = 0.0000002
STEP_FUNCTIONS_PER_TRANSITION = 0.000025

STACK = "MinuteMaker"
region = "us-west-2"
cfn = boto3.client("cloudformation", region)
sfn = boto3.client("stepfunctions", region)
logs = boto3.client("logs", region)
lam = boto3.client("lambda", region)
ddb = boto3.client("dynamodb", region)
textract = boto3.client("textract", region)

meeting_id = sys.argv[1]
resources = [r for page in cfn.get_paginator("list_stack_resources").paginate(StackName=STACK)
             for r in page["StackResourceSummaries"]]
physical = {r["LogicalResourceId"]: r["PhysicalResourceId"] for r in resources}
table = next(v for k, v in physical.items() if k.startswith("DataResourcesMeetingsTable"))
machine = next(v for k, v in physical.items() if k.startswith("MeetingProcessorIntegrationMeetingProcessingWorkflow"))
functions = [r["PhysicalResourceId"] for r in resources if r["ResourceType"] == "AWS::Lambda::Function"]

meeting = ddb.query(TableName=table, KeyConditionExpression="meetingId = :m",
                    ExpressionAttributeValues={":m": {"S": meeting_id}})["Items"][0]
execution = None
for page in sfn.get_paginator("list_executions").paginate(stateMachineArn=machine):
    for e in page["executions"]:
        if meeting_id in sfn.describe_execution(executionArn=e["executionArn"])["input"]:
            execution = sfn.describe_execution(executionArn=e["executionArn"])
            break
    if execution:
        break
history = sfn.get_execution_history(executionArn=execution["executionArn"], maxResults=1000)["events"]
start = execution["startDate"] - timedelta(minutes=3)  # the agenda Lambda starts at upload, just before
end = execution.get("stopDate", execution["startDate"] + timedelta(hours=3)) + timedelta(minutes=1)


def log_lines(function_name):
    group = lam.get_function_configuration(FunctionName=function_name).get("LoggingConfig", {}).get(
        "LogGroup", f"/aws/lambda/{function_name}")
    kwargs = dict(logGroupName=group, startTime=int(start.timestamp() * 1000), endTime=int(end.timestamp() * 1000))
    try:
        for page in logs.get_paginator("filter_log_events").paginate(**kwargs):
            for event in page["events"]:
                yield event["message"]
    except logs.exceptions.ResourceNotFoundException:
        return


rows = []

# Bedrock: every model call either AI Lambda logged in the window
tokens = {}
textract_jobs = []
gb_seconds = requests = 0
for fn in functions:
    for line in log_lines(fn):
        m = re.search(r"Model (claude-[\w-]+) stopped with \w+: (\d+) input tokens, (\d+) output tokens", line)
        if m:
            t = tokens.setdefault(m.group(1), [0, 0, 0])
            t[0] += int(m.group(2)); t[1] += int(m.group(3)); t[2] += 1
        m = re.search(r"Textract job started with ID: (\w+)", line)
        if m:
            textract_jobs.append(m.group(1))
        m = re.search(r"Billed Duration: (\d+) ms\s+Memory Size: (\d+) MB", line)
        if m:
            gb_seconds += int(m.group(1)) / 1000 * int(m.group(2)) / 1024
            requests += 1
for model, (tin, tout, calls) in tokens.items():
    pin, pout = BEDROCK_PER_MILLION.get(model, (float("nan"), float("nan")))
    rows.append((f"Bedrock {model} ({calls} call{'s' * (calls > 1)})", f"{tin:,} in / {tout:,} out tokens",
                 tin / 1e6 * pin + tout / 1e6 * pout))

# Audio: MediaConvert output duration, which is also what Transcribe processes
mediaconvert = boto3.client("mediaconvert", region, endpoint_url=boto3.client("mediaconvert", region)
                            .describe_endpoints()["Endpoints"][0]["Url"])
audio_seconds = 0
for page in mediaconvert.get_paginator("list_jobs").paginate():
    for job in page["Jobs"]:
        if start <= job["CreatedAt"] <= end and meeting_id in json.dumps(job["Settings"]["Inputs"]):
            for group in job.get("OutputGroupDetails", []):
                for out in group.get("OutputDetails", []):
                    audio_seconds += out.get("DurationInMs", 0) / 1000
    if page["Jobs"] and page["Jobs"][-1]["CreatedAt"] < start:
        break
rows.append(("MediaConvert (audio extraction)", f"{audio_seconds / 60:.1f} audio minutes", audio_seconds / 60 * MEDIACONVERT_PER_MINUTE))
rows.append(("Transcribe (speech to text)", f"{audio_seconds / 60:.1f} audio minutes", audio_seconds * TRANSCRIBE_PER_SECOND))

pages = sum(textract.get_document_text_detection(JobId=j, MaxResults=1)["DocumentMetadata"]["Pages"] for j in set(textract_jobs))
rows.append(("Textract (agenda PDF text)", f"{pages} pages", pages * TEXTRACT_PER_PAGE))
rows.append(("Lambda (all functions)", f"{gb_seconds:,.0f} GB-seconds, {requests} invocations",
             gb_seconds * LAMBDA_PER_GB_SECOND + requests * LAMBDA_PER_REQUEST))
transitions = sum(1 for e in history if e["type"].endswith("StateEntered"))
rows.append(("Step Functions", f"{transitions} state transitions", transitions * STEP_FUNCTIONS_PER_TRANSITION))

minutes_long = audio_seconds / 60
print(f"Meeting {meeting_id}: \"{meeting.get('meetingTitle', {}).get('S', '')}\", "
      f"{minutes_long:.0f} min of video, run took {(execution['stopDate'] - execution['startDate']).seconds / 60:.1f} min ({execution['status']})")
for name, usage, cost in rows:
    print(f"  {name:38s} {usage:40s} ${cost:7.4f}")
total = sum(c for _, _, c in rows)
print(f"  {'TOTAL':38s} {'':40s} ${total:7.4f}   (${total / minutes_long * 60:.2f} per hour of video)")
