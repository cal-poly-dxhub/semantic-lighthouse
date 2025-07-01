import json
import boto3
import logging
from urllib.parse import urlparse

logger = logging.getLogger()
logger.setLevel(logging.INFO)

s3_client = boto3.client("s3")


def lambda_handler(event, context):
    """
    Verify that an S3 file exists by parsing the S3 URI and checking the object.

    Input: {"s3_uri": "s3://bucket/key"}
    Output: {"exists": true/false, "bucket": "bucket", "key": "key"}
    """
    logger.info(f"Received event: {json.dumps(event)}")

    s3_uri = event.get("s3_uri")
    if not s3_uri:
        raise ValueError("s3_uri is required in the input event")

    # Parse the S3 URI
    parsed = urlparse(s3_uri)
    if parsed.scheme != "s3":
        raise ValueError(f"Invalid S3 URI scheme: {parsed.scheme}")

    bucket = parsed.netloc
    key = parsed.path.lstrip("/")

    logger.info(f"Checking if s3://{bucket}/{key} exists")

    try:
        # Use head_object to check if the file exists
        s3_client.head_object(Bucket=bucket, Key=key)
        logger.info(f"File exists: s3://{bucket}/{key}")
        exists = True
    except s3_client.exceptions.NoSuchKey:
        logger.warning(f"File does not exist: s3://{bucket}/{key}")
        exists = False
    except Exception as e:
        logger.error(f"Error checking file existence: {e}")
        raise

    result = {"exists": exists, "bucket": bucket, "key": key, "s3_uri": s3_uri}

    logger.info(f"Returning result: {json.dumps(result)}")
    return result
