import os
import boto3
import json
import logging
from urllib.parse import urlparse

logger = logging.getLogger()
logger.setLevel(logging.INFO)

s3_client = boto3.client("s3")


def convert_to_human_readable(transcript_data):
    """Converts a raw Transcribe JSON into a readable text format with speaker labels."""
    try:
        items = transcript_data["results"]["items"]
        segments = transcript_data["results"]["speaker_labels"]["segments"]

        # Assign speaker to each word
        word_list = []
        segment_iter = iter(segments)
        current_segment = next(segment_iter, None)
        for item in items:
            if item["type"] == "pronunciation":
                word = {
                    "start_time": float(item["start_time"]),
                    "content": item["alternatives"][0]["content"],
                }
                while current_segment and word["start_time"] > float(
                    current_segment["end_time"]
                ):
                    current_segment = next(segment_iter, None)
                if current_segment:
                    word["speaker"] = current_segment["speaker_label"]
                word_list.append(word)
            else:  # punctuation
                word_list[-1]["content"] += item["alternatives"][0]["content"]

        # Group words by speaker into final lines
        output_lines = []
        current_speaker = None
        current_line = ""
        line_start_time = 0
        for word in word_list:
            speaker = word.get("speaker", "spk_unknown")
            if speaker != current_speaker:
                if current_line:
                    h = int(line_start_time // 3600)
                    m = int((line_start_time % 3600) // 60)
                    s = int(line_start_time % 60)
                    timestamp = f"[{h:02d}:{m:02d}:{s:02d}]"
                    output_lines.append(
                        f"{timestamp} {current_speaker}: {current_line.strip()}"
                    )

                current_speaker = speaker
                line_start_time = word["start_time"]
                current_line = word["content"]
            else:
                current_line += f" {word['content']}"

        # Add the last line
        if current_line:
            h = int(line_start_time // 3600)
            m = int((line_start_time % 3600) // 60)
            s = int(line_start_time % 60)
            timestamp = f"[{h:02d}:{m:02d}:{s:02d}]"
            output_lines.append(
                f"{timestamp} {current_speaker}: {current_line.strip()}"
            )

        logger.info(
            f"Successfully converted transcript to human readable format with {len(output_lines)} lines"
        )
        return "\n".join(output_lines)
    except Exception as e:
        logger.error(f"Error during transcript conversion: {e}")
        return "Could not process transcript."


def handler(event, context):
    """
    Lambda function handler invoked by Step Functions.
    Fetches a completed Transcribe job's result, converts it to a
    human-readable format, and saves it back to S3.
    """
    logger.info("=== ProcessTranscript Lambda Started ===")
    logger.info(f"Received event: {json.dumps(event, indent=2)}")

    bucket_name = os.environ["S3_BUCKET"]
    logger.info(f"Using S3 bucket: {bucket_name}")

    try:
        # Get transcription result from the Step Function event
        transcription_job = event["transcriptionResult"]["TranscriptionJob"]
        job_name = transcription_job["TranscriptionJobName"]
        job_status = transcription_job["TranscriptionJobStatus"]

        logger.info(f"Processing transcript for job: {job_name}")
        logger.info(f"Job status: {job_status}")

        if job_status != "COMPLETED":
            raise ValueError(
                f"Transcription job is not completed. Status: {job_status}"
            )

        uri = transcription_job["Transcript"]["TranscriptFileUri"]
        logger.info(f"Transcript URI: {uri}")

        parsed = urlparse(uri)
        logger.info(
            f"Parsed URI - scheme: {parsed.scheme}, netloc: {parsed.netloc}, path: {parsed.path}"
        )

        # Since we control the output bucket via OutputBucketName in the state machine,
        # the transcript should be in our bucket. Let's use that instead of parsing.
        # But we still need the key from the URI path.
        input_key = parsed.path.lstrip("/")

        # For HTTPS URLs like https://s3.region.amazonaws.com/bucket/key,
        # the path includes the bucket name, so we need to strip it off
        if parsed.scheme == "https" and input_key.startswith(f"{bucket_name}/"):
            input_key = input_key[len(f"{bucket_name}/") :]
            logger.info(
                f"Stripped bucket name from HTTPS URL path. New key: {input_key}"
            )

        # Use our own bucket since we set OutputBucketName in the state machine
        input_bucket = bucket_name

        logger.info(
            f"Will fetch transcript from bucket: {input_bucket}, key: {input_key}"
        )

        # Get the transcript JSON from S3
        logger.info("Fetching transcript JSON from S3...")
        response = s3_client.get_object(Bucket=input_bucket, Key=input_key)
        transcript_data = json.loads(response["Body"].read().decode("utf-8"))

        logger.info("Successfully fetched and parsed transcript JSON")
        logger.info(
            f"Transcript contains {len(transcript_data.get('results', {}).get('items', []))} items"
        )

        # Convert to human-readable format
        logger.info("Converting transcript to human-readable format...")
        human_readable_transcript = convert_to_human_readable(transcript_data)

        # Save human-readable version to S3
        human_readable_key = f"transcripts/{job_name}_human_readable.txt"

        logger.info(
            f"Saving human-readable transcript to s3://{bucket_name}/{human_readable_key}"
        )
        s3_client.put_object(
            Bucket=bucket_name,
            Key=human_readable_key,
            Body=human_readable_transcript.encode("utf-8"),
            ContentType="text/plain",
        )

        logger.info("=== ProcessTranscript Lambda Completed Successfully ===")
        logger.info(
            f"Human-readable transcript saved to: s3://{bucket_name}/{human_readable_key}"
        )

        return {
            "statusCode": 200,
            "message": "Transcript processing completed successfully",
            "humanReadableKey": human_readable_key,
            "transcriptLength": len(human_readable_transcript),
        }

    except Exception as e:
        logger.error("=== ProcessTranscript Lambda FAILED ===")
        logger.error(f"Error type: {type(e).__name__}")
        logger.error(f"Error message: {str(e)}")
        logger.error(f"Full traceback:", exc_info=True)

        # Log additional debugging info
        if "event" in locals():
            logger.error(f"Event data: {json.dumps(event, indent=2)}")
        if "bucket_name" in locals():
            logger.error(f"Bucket name: {bucket_name}")
        if "input_bucket" in locals() and "input_key" in locals():
            logger.error(f"Attempted to access: s3://{input_bucket}/{input_key}")

        # Fail the Step Function state on error
        raise e
