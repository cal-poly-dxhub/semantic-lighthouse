import os
import boto3
import json
import logging
from datetime import datetime

# Configure logging to see output in CloudWatch, which is crucial for debugging
logger = logging.getLogger()
logger.setLevel(logging.INFO)

def get_mediaconvert_client():
    """
    Initializes and returns a boto3 client for AWS Elemental MediaConvert.
    It dynamically discovers the regional endpoint required for API calls.
    """
    region = os.environ.get('AWS_REGION')
    if not region:
        # This should always be set in a Lambda environment
        raise ValueError("AWS_REGION environment variable is not set.")

    try:
        # For MediaConvert, you must provide the regional endpoint URL.
        # We can discover this URL programmatically so the code is region-agnostic.
        mc_endpoints = boto3.client('mediaconvert', region_name=region).describe_endpoints(MaxResults=1)
        return boto3.client('mediaconvert', region_name=region, endpoint_url=mc_endpoints['Endpoints'][0]['Url'])
    except Exception as e:
        logger.error(f"Failed to create MediaConvert client: {e}")
        raise

def handler(event, context):
    """
    Lambda function handler triggered by an S3 upload event.

    This function starts an AWS Elemental MediaConvert job to transcode an
    uploaded video file into an MP3 audio file.

    Args:
        event (dict): The event dictionary containing S3 event data.
        context (object): The Lambda context object (not used).

    Returns:
        dict: A dictionary containing details about the job, which can be
              passed to the next state in a Step Function.
    """
    logger.info("Received event: %s", json.dumps(event))

    # --- 1. Get Configuration from Environment Variables ---
    # These are set in the template.yaml and passed to the Lambda function.
    try:
        mediaconvert_role_arn = os.environ['MEDIACONVERT_ROLE_ARN']
        job_template_name = os.environ['JOB_TEMPLATE_NAME']
    except KeyError as e:
        logger.error(f"CRITICAL: Missing required environment variable: {e}")
        raise ValueError(f"Configuration error: Missing environment variable {e}")

    # --- 2. Parse Input Event from S3 ---
    try:
        record = event['Records'][0]
        s3_bucket = record['s3']['bucket']['name']
        s3_key = record['s3']['object']['key']
    except (KeyError, IndexError) as e:
        logger.error(f"Failed to parse S3 event record: {e}")
        raise ValueError("Invalid S3 event structure. Cannot find bucket or key.")

    source_s3_path = f"s3://{s3_bucket}/{s3_key}"

    # --- 3. Define Output Destination Path ---
    # This logic creates a clean output path in a different 'folder'.
    # Example Input:  'uploads/user-123/meeting-abc/recording/meeting.mp4'
    # Example Output: 'uploads/user-123/meeting-abc/processing/meeting'
    # MediaConvert will automatically add the '.mp3' extension based on the template.
    try:
        # Note: S3 keys are case-sensitive.
        path_parts = s3_key.split('/')
        if 'recording' in path_parts:
             path_parts[path_parts.index('recording')] = 'processing'
        else:
             # Fallback if 'recording' is not in the path, place it in a root processing folder
             path_parts.insert(0, 'processing')

        filename_without_ext = path_parts[-1].rsplit('.', 1)[0]
        path_parts[-1] = filename_without_ext
        destination_key_prefix = '/'.join(path_parts)

    except IndexError:
        logger.error(f"Could not parse the S3 key '{s3_key}' to create a destination path.")
        raise ValueError("S3 key structure is not valid for processing.")

    destination_s3_path = f"s3://{s3_bucket}/{destination_key_prefix}"
    final_audio_s3_uri = f"{destination_s3_path}.mp3"

    # --- 4. Create and Start the MediaConvert Job ---
    try:
        mc_client = get_mediaconvert_client()

        # Unique token to prevent duplicate jobs on Lambda retries.
        client_request_token = str(datetime.now().timestamp())

        logger.info(f"Starting MediaConvert job for source: {source_s3_path}")

        job_settings = {
            "Inputs": [
                {
                    "AudioSelectors": { "Audio Selector 1": { "DefaultSelection": "DEFAULT" } },
                    "FileInput": source_s3_path,
                }
            ],
            "OutputGroups": [
                {
                    "Name": "File Group",
                    "OutputGroupSettings": {
                        "Type": "FILE_GROUP_SETTINGS",
                        "Destination": destination_s3_path
                    },
                }
            ]
        }

        response = mc_client.create_job(
            Role=mediaconvert_role_arn,
            JobTemplate=job_template_name,
            Settings=job_settings,
            ClientRequestToken=client_request_token
        )

        job_id = response['Job']['Id']
        logger.info(f"Successfully started MediaConvert job {job_id}")

        # This return payload is critical as it passes data to the next Step Function state
        return {
            'statusCode': 200,
            'jobId': job_id,
            'audioS3Uri': final_audio_s3_uri,
            'sourceS3Bucket': s3_bucket,
            'sourceS3Key': s3_key
        }

    except Exception as e:
        logger.error(f"Exception while starting MediaConvert job: {e}")
        raise # Re-raise to signal failure to the caller (e.g., Step Functions)

