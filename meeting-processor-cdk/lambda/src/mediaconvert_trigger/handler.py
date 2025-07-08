import json
import boto3
import uuid
import math
import logging
from urllib.parse import unquote_plus

# Provided by lambda layer
from pymediainfo import MediaInfo  # type: ignore
import os

# Set up logging
logger = logging.getLogger()
logger.setLevel(logging.INFO)

# Initialize AWS clients
s3_client = boto3.client("s3")
mediaconvert_client = boto3.client("mediaconvert")

# Configuration

# Chunking configuration
CHUNK_DURATION_HOURS = (
    4  # Split videos into 4-hour chunks (AWS Transcribe limits files to 4)
)
DURATION_THRESHOLD_HOURS = 4  # Split if video > 4 hours
SIGNED_URL_EXPIRATION = 300  # 5 minutes (arbitrary but should be enough)


def get_target_bucket(source_bucket):
    """Return target bucket (same as source bucket)."""
    return source_bucket


def generate_signed_url(bucket, key, expiration=SIGNED_URL_EXPIRATION):
    """Generate a presigned S3 URL so MediaInfo can stream metadata."""
    return s3_client.generate_presigned_url(
        "get_object", Params={"Bucket": bucket, "Key": key}, ExpiresIn=expiration
    )


def get_video_duration_seconds(bucket, key):
    """Extract video duration using pymediainfo + presigned URL."""
    signed_url = generate_signed_url(bucket, key)
    media_info = MediaInfo.parse(signed_url)
    for track in media_info.tracks:
        if track.track_type == "General" and getattr(track, "duration", None):
            return float(track.duration) / 1000.0
    return None


def should_split_video(duration_seconds):
    return (duration_seconds or 0) / 3600 > DURATION_THRESHOLD_HOURS


def calculate_chunks(duration_seconds):
    return math.ceil((duration_seconds / 3600) / CHUNK_DURATION_HOURS)


def create_mediaconvert_job(
    source_bucket, key, target_bucket, job_name, chunk_info=None
):
    """Submit an AWS MediaConvert job for MP3 extraction."""
    base_filename = ".".join(key.split("/")[-1].split(".")[:-1])
    output_modifier = (
        f"_part{chunk_info['part_number']:02d}" if chunk_info else "_converted"
    )
    job_description = (
        f"Part {chunk_info['part_number']}" if chunk_info else "Full video conversion"
    )

    input_settings = {
        "FileInput": f"s3://{source_bucket}/{key}",
        "AudioSelectors": {"Audio Selector 1": {"DefaultSelection": "DEFAULT"}},
    }

    if chunk_info:
        start = chunk_info["start_time_seconds"]
        end = start + chunk_info["duration_seconds"]
        start_tc = (
            f"{int(start//3600):02d}:{int(start%3600//60):02d}:{int(start%60):02d}:00"
        )
        end_tc = f"{int(end//3600):02d}:{int(end%3600//60):02d}:{int(end%60):02d}:00"
        input_settings["InputClippings"] = [
            {"StartTimecode": start_tc, "EndTimecode": end_tc}
        ]

    job_settings = {
        "Role": "arn:aws:iam::412072465402:role/MediaConvertServiceRole",
        "Settings": {
            "Inputs": [input_settings],
            "OutputGroups": [
                {
                    "Name": "Audio MP3",
                    "OutputGroupSettings": {
                        "Type": "FILE_GROUP_SETTINGS",
                        "FileGroupSettings": {
                            "Destination": f"s3://{target_bucket}/audio/"
                        },
                    },
                    "Outputs": [
                        {
                            "NameModifier": output_modifier,
                            "AudioDescriptions": [
                                {
                                    "CodecSettings": {
                                        "Codec": "MP3",
                                        "Mp3Settings": {
                                            "Bitrate": 192000,
                                            "Channels": 2,
                                            "SampleRate": 44100,
                                            "RateControlMode": "CBR",
                                        },
                                    },
                                    "AudioSourceName": "Audio Selector 1",
                                }
                            ],
                            "ContainerSettings": {"Container": "RAW"},
                        }
                    ],
                }
            ],
        },
        "Queue": "arn:aws:mediaconvert:us-west-2:412072465402:queues/Default",
        "UserMetadata": {
            "OriginalFile": key,
            "SourceBucket": source_bucket,
            "TargetBucket": target_bucket,
            "ProcessingType": "VideoToMP3",
            "JobDescription": job_description,
            "ChunkInfo": json.dumps(chunk_info) if chunk_info else "FullVideo",
        },
    }

    response = mediaconvert_client.create_job(**job_settings)
    return response


def lambda_handler(event, context):
    logger.info("=== MediaConvert Trigger Lambda Started ===")
    logger.info("Event payload: %s", json.dumps(event))

    job_ids = []
    target_bucket = None
    audio_output_keys = []

    # Normalize incoming event into a list of objects with bucket/key
    records = []

    # Case 1: S3 event structure
    if "Records" in event:
        records = event["Records"]
    # Case 2: Step Functions custom payload
    elif "inputBucket" in event and "inputKey" in event:
        records = [
            {
                "s3": {
                    "bucket": {"name": event["inputBucket"]},
                    "object": {"key": event["inputKey"]},
                }
            }
        ]
        # If Step Functions passed an explicit outputBucket, use that directly later
        target_bucket = event.get("outputBucket")
    else:
        logger.warning(
            "Received event is not in expected format. Keys: %s", list(event.keys())
        )

    logger.info("Total S3 event records received: %d", len(records))
    for idx, record in enumerate(records):
        logger.info("--- Processing record %d/%d ---", idx + 1, len(records))
        bucket = record["s3"]["bucket"]["name"]
        key = unquote_plus(record["s3"]["object"]["key"])

        logger.info("Incoming object: s3://%s/%s", bucket, key)

        # Bucket validation removed - IAM permissions provide security boundary
        logger.info("Processing bucket: %s", bucket)

        # If Step Functions provided output bucket use it; otherwise derive
        if not target_bucket:
            target_bucket = get_target_bucket(bucket)

        if not target_bucket:
            logger.error("No valid target bucket – skipping file %s", key)
            continue

        logger.info("Target bucket resolved: %s", target_bucket)

        duration_seconds = get_video_duration_seconds(bucket, key)
        if duration_seconds is None:
            logger.error(
                "Could not determine video duration via MediaInfo – skipping file %s",
                key,
            )
            continue

        logger.info(
            "Video duration: %.2f seconds (%.2f hours)",
            duration_seconds,
            duration_seconds / 3600,
        )

        if should_split_video(duration_seconds):
            logger.info(
                "Video exceeds %d hours – performing chunked processing",
                DURATION_THRESHOLD_HOURS,
            )
            num_chunks = calculate_chunks(duration_seconds)
            logger.info("Total chunks to create: %d", num_chunks)
            for part in range(1, num_chunks + 1):
                start_time = (part - 1) * CHUNK_DURATION_HOURS * 3600
                chunk_dur = min(
                    CHUNK_DURATION_HOURS * 3600, duration_seconds - start_time
                )
                job_name = f"video-to-mp3-chunk-{part:02d}-{uuid.uuid4().hex[:8]}"
                logger.info(
                    "Creating chunk %d job (start %.0f s, duration %.0f s)",
                    part,
                    start_time,
                    chunk_dur,
                )
                resp = create_mediaconvert_job(
                    bucket,
                    key,
                    target_bucket,
                    job_name,
                    {
                        "part_number": part,
                        "start_time_seconds": start_time,
                        "duration_seconds": chunk_dur,
                        "total_chunks": num_chunks,
                    },
                )
                job_ids.append(resp["Job"]["Id"])
                base_filename = os.path.splitext(os.path.basename(key))[0]
                output_key = f"audio/{base_filename}_part{part:02d}.mp3"
                audio_output_keys.append(output_key)
        else:
            logger.info("Video under threshold – single job conversion mode")
            job_name = f"video-to-mp3-{uuid.uuid4().hex[:8]}"
            logger.info("Creating single MediaConvert job: %s", job_name)
            resp = create_mediaconvert_job(bucket, key, target_bucket, job_name)
            job_ids.append(resp["Job"]["Id"])
            base_filename = os.path.splitext(os.path.basename(key))[0]
            output_key = f"audio/{base_filename}_converted.mp3"
            audio_output_keys.append(output_key)

    logger.info("=== Summary ===")
    logger.info("Total MediaConvert jobs submitted: %d", len(job_ids))
    if not job_ids:
        logger.warning("No jobs were submitted - check earlier logs for reasons")
    else:
        for i, jid in enumerate(job_ids, 1):
            logger.info("Job %d ID: %s", i, jid)

    # Build the payload expected by the Step Functions state machine
    response_body = {
        "message": "Jobs submitted" if job_ids else "No jobs created",
        "job_ids": job_ids,
    }

    result = {
        "statusCode": 200,
        "body": json.dumps(response_body),
        "status": "COMPLETED" if job_ids else "ERROR",
        "job_ids": job_ids,
    }

    # Include audioOutputUri only if we have a target bucket
    if target_bucket and audio_output_keys:
        # Select first output for downstream Transcribe step
        result["audioOutputUri"] = f"s3://{target_bucket}/{audio_output_keys[0]}"
        result["audioOutputUris"] = [
            f"s3://{target_bucket}/{k}" for k in audio_output_keys
        ]

    return result
