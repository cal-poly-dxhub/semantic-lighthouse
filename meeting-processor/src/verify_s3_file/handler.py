import json
import boto3
import logging
from urllib.parse import urlparse

logger = logging.getLogger()
logger.setLevel(logging.INFO)

s3_client = boto3.client("s3")
mediaconvert_client = boto3.client("mediaconvert")


def check_mediaconvert_jobs_status(job_ids):
    """
    Check the status of multiple MediaConvert jobs.
    This avoids URI length issues in Step Functions Map states.

    Args:
        job_ids (list): List of MediaConvert job IDs

    Returns:
        dict: Status information for all jobs
    """
    logger.info(f"Checking status of {len(job_ids)} MediaConvert jobs")

    job_statuses = []
    all_complete = True
    any_failed = False

    for i, job_id in enumerate(job_ids):
        try:
            logger.info(f"Checking job {i+1}/{len(job_ids)}: {job_id}")
            response = mediaconvert_client.get_job(Id=job_id)
            status = response["Job"]["Status"]

            job_statuses.append({"jobId": job_id, "status": status, "index": i})

            if status != "COMPLETE":
                all_complete = False
            if status in ["ERROR", "CANCELED"]:
                any_failed = True
                logger.error(f"Job {job_id} failed with status: {status}")

        except Exception as e:
            logger.error(f"Error checking job {job_id}: {e}")
            job_statuses.append(
                {"jobId": job_id, "status": "ERROR", "error": str(e), "index": i}
            )
            any_failed = True
            all_complete = False

    logger.info(
        f"Job status summary: all_complete={all_complete}, any_failed={any_failed}"
    )

    return {
        "allComplete": all_complete,
        "anyFailed": any_failed,
        "jobStatuses": job_statuses,
        "totalJobs": len(job_ids),
        "completedJobs": len([j for j in job_statuses if j["status"] == "COMPLETE"]),
    }


def lambda_handler(event, context):
    """
    Verify that an S3 file exists by parsing the S3 URI and checking the object.
    Also supports checking MediaConvert job statuses in batch.

    Input:
        - {"s3_uri": "s3://bucket/key"} for S3 file verification
        - {"job_ids": ["job1", "job2", ...]} for MediaConvert job status checking

    Output:
        - {"exists": true/false, "bucket": "bucket", "key": "key"} for S3
        - {"allComplete": true/false, "anyFailed": true/false, "jobStatuses": [...]} for MediaConvert
    """
    logger.info(f"Received event: {json.dumps(event)}")

    # Check if this is a MediaConvert job status request
    if "job_ids" in event:
        job_ids = event["job_ids"]
        if not job_ids or not isinstance(job_ids, list):
            raise ValueError("job_ids must be a non-empty list")

        return check_mediaconvert_jobs_status(job_ids)

    # Otherwise, handle S3 file verification (original functionality)
    s3_uri = event.get("s3_uri")
    if not s3_uri:
        raise ValueError("Either s3_uri or job_ids is required in the input event")

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
