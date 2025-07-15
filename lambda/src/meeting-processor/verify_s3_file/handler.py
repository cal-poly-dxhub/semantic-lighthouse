import json
import boto3
import logging
import os
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


def extract_correlation_key_from_video(video_s3_key):
    """
    Extract correlation key from video S3 key
    {id}/uploads/video.mp4 -> {id}
    """
    return video_s3_key.split("/")[0]  # Get the ID (first part of path)


def check_agenda_exists(bucket, correlation_key, meeting_id):
    """
    Check if agenda analysis exists for the given correlation key
    Returns both the existence status and the analysis data if available
    """
    analysis_key = f"{meeting_id}/processed/agenda_analysis.json"
    raw_text_key = f"{meeting_id}/processed/agenda_text.txt"

    try:
        # Check if analysis file exists
        s3_client.head_object(Bucket=bucket, Key=analysis_key)

        # If it exists, try to load the analysis data
        try:
            response = s3_client.get_object(Bucket=bucket, Key=analysis_key)
            analysis_data = json.loads(response["Body"].read().decode("utf-8"))

            return {
                "agenda_exists": True,
                "analysis_s3_uri": f"s3://{bucket}/{analysis_key}",
                "raw_text_s3_uri": f"s3://{bucket}/{raw_text_key}",
                "analysis_data": analysis_data,
                "correlation_key": correlation_key,
            }
        except Exception as e:
            logger.warning(f"Agenda analysis file exists but couldn't be loaded: {e}")
            return {
                "agenda_exists": True,
                "analysis_s3_uri": f"s3://{bucket}/{analysis_key}",
                "raw_text_s3_uri": f"s3://{bucket}/{raw_text_key}",
                "analysis_data": None,
                "correlation_key": correlation_key,
                "error": f"Failed to load analysis: {e}",
            }

    except s3_client.exceptions.NoSuchKey:
        logger.info(f"No agenda analysis found for correlation key: {correlation_key}")
        return {"agenda_exists": False, "correlation_key": correlation_key}
    except Exception as e:
        logger.error(f"Error checking agenda existence: {e}")
        return {
            "agenda_exists": False,
            "correlation_key": correlation_key,
            "error": str(e),
        }


def lambda_handler(event, context):
    """
    Verify that an S3 file exists by parsing the S3 URI and checking the object.
    Also supports checking MediaConvert job statuses in batch and agenda checking.

    Input:
        - {"s3_uri": "s3://bucket/key"} for S3 file verification
        - {"job_ids": ["job1", "job2", ...]} for MediaConvert job status checking
        - {"check_agenda": true, "video_s3_key": "uploads/meeting_recordings/file.mp4"} for agenda checking

    Output:
        - {"exists": true/false, "bucket": "bucket", "key": "key"} for S3
        - {"allComplete": true/false, "anyFailed": true/false, "jobStatuses": [...]} for MediaConvert
        - {"agenda_exists": true/false, "analysis_data": {...}, ...} for agenda checking
    """
    logger.info(f"Received event: {json.dumps(event)}")

    # Check if this is an agenda checking request
    if event.get("check_agenda"):
        video_s3_key = event.get("video_s3_key")
        meeting_id = event.get("meeting_id")
        if not video_s3_key:
            raise ValueError("video_s3_key is required when check_agenda is true")

        # Extract correlation key from video path
        correlation_key = extract_correlation_key_from_video(video_s3_key)

        # Get bucket from environment or event
        bucket = os.environ.get("BUCKET_NAME")
        if not bucket:
            raise ValueError("BUCKET_NAME environment variable is required")

        result = check_agenda_exists(bucket, correlation_key, meeting_id)
        logger.info(f"Agenda check result: {json.dumps(result)}")
        return result

    # Check if this is a MediaConvert job status request
    if "job_ids" in event:
        job_ids = event["job_ids"]
        if not job_ids or not isinstance(job_ids, list):
            raise ValueError("job_ids must be a non-empty list")

        return check_mediaconvert_jobs_status(job_ids)

    # Otherwise, handle S3 file verification (original functionality)
    s3_uri = event.get("s3_uri")
    if not s3_uri:
        raise ValueError(
            "Either s3_uri, job_ids, or check_agenda is required in the input event"
        )

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
