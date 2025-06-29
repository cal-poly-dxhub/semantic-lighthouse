import os
import boto3
import json
import logging
from datetime import datetime
from pathlib import Path

# Configure logging
logger = logging.getLogger()
logger.setLevel(logging.INFO)


def start_transcribe_job(transcribe_client, video_s3_uri, job_name, role_arn):
    """Start AWS Transcribe job directly on video file"""
    try:
        response = transcribe_client.start_transcription_job(
            TranscriptionJobName=job_name,
            Media={"MediaFileUri": video_s3_uri},
            MediaFormat="mp4",  # Transcribe supports video files directly
            LanguageCode="en-US",
            Settings={
                "ShowSpeakerLabels": True,
                "MaxSpeakerLabels": 10,
                "ShowAlternatives": False,
            },
            OutputBucketName=os.environ["S3_BUCKET"],
            OutputKey=f"transcripts/{job_name}.json",
        )

        logger.info(f"Started Transcribe job: {job_name}")
        return True, response["TranscriptionJob"]["TranscriptionJobStatus"]

    except Exception as e:
        logger.error(f"Failed to start Transcribe job: {e}")
        return False, str(e)


def handler(event, context):
    """
    Lambda function handler triggered by S3 upload event.

    Starts AWS Transcribe job directly on the uploaded video file.
    """
    logger.info("Received event: %s", json.dumps(event))

    # Initialize AWS clients
    transcribe_client = boto3.client("transcribe", region_name="us-west-2")

    # Get configuration
    bucket_name = os.environ["S3_BUCKET"]
    transcribe_role_arn = os.environ["TRANSCRIBE_ROLE_ARN"]

    # Parse S3 event
    try:
        record = event["Records"][0]
        source_bucket = record["s3"]["bucket"]["name"]
        source_key = record["s3"]["object"]["key"]
    except (KeyError, IndexError) as e:
        logger.error(f"Failed to parse S3 event: {e}")
        raise ValueError("Invalid S3 event structure")

    # Create unique job name
    timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    job_name = f"meeting-{timestamp}-{Path(source_key).stem}"

    # Create S3 URI for the video file
    video_s3_uri = f"s3://{source_bucket}/{source_key}"

    # Start Transcribe job directly on the video
    success, status = start_transcribe_job(
        transcribe_client, video_s3_uri, job_name, transcribe_role_arn
    )

    if not success:
        raise Exception(f"Failed to start Transcribe job: {status}")

    logger.info(f"Successfully started transcription job: {job_name}")

    return {
        "statusCode": 200,
        "jobName": job_name,
        "videoS3Uri": video_s3_uri,
        "transcriptionStatus": status,
    }
