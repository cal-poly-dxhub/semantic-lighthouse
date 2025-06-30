import os
import boto3
import json
import logging
from urllib.parse import urlparse

logger = logging.getLogger()
logger.setLevel(logging.INFO)

s3_client = boto3.client("s3")


def convert_to_human_readable(transcript_data):
    """
    Converts a raw Transcribe JSON into a readable text format with speaker labels using segments.

    Output format: [seg_X][speaker_label][HH:MM:SS] spoken text
    Example: [seg_0][spk_0][00:00:15] Hello everyone, welcome to the meeting.

    This format allows easy parsing with regex: \[([^\]]+)\]\[([^\]]+)\]\[([^\]]+)\] (.+)
    Groups: (1) segment_id, (2) speaker, (3) timestamp, (4) text
    """
    try:
        # Check if the results contain the expected format
        if (
            "results" not in transcript_data
            or "speaker_labels" not in transcript_data["results"]
            or "items" not in transcript_data["results"]
        ):
            logger.error("Error: Unexpected format in the transcript file.")
            return "Could not process transcript: unexpected format."

        # Use audio_segments if available (preferred method)
        if "audio_segments" in transcript_data["results"]:
            logger.info("Using audio_segments for transcript processing")
            # Sort segments by start_time to maintain chronological order
            segments = sorted(
                transcript_data["results"]["audio_segments"],
                key=lambda x: float(x["start_time"]),
            )

            # Create a list of sequential utterances with speaker labels and IDs
            output_lines = []
            for idx, segment in enumerate(segments):
                speaker = segment["speaker_label"]
                text = segment["transcript"]
                segment_id = f"seg_{idx}"
                start_time = float(segment["start_time"])

                # Format timestamp
                h = int(start_time // 3600)
                m = int((start_time % 3600) // 60)
                s = int(start_time % 60)
                timestamp = f"{h:02d}:{m:02d}:{s:02d}"

                output_lines.append(f"[{segment_id}][{speaker}][{timestamp}] {text}")

            logger.info(
                f"Successfully converted transcript using audio_segments with {len(output_lines)} segments (with timestamps)"
            )
            return "\n".join(output_lines)

        # If audio_segments doesn't exist, build segments from speaker_labels and items
        else:
            logger.info("Using speaker_labels and items for transcript processing")
            # Get speaker segments with timing information
            speaker_segments = []
            for segment in transcript_data["results"]["speaker_labels"]["segments"]:
                speaker_segments.append(
                    {
                        "speaker_label": segment["speaker_label"],
                        "start_time": float(segment["start_time"]),
                        "end_time": float(segment["end_time"]),
                        "items": [item["start_time"] for item in segment["items"]],
                    }
                )

            # Sort segments by start_time
            speaker_segments = sorted(speaker_segments, key=lambda x: x["start_time"])

            # Get all items with their content
            items_dict = {}
            for item in transcript_data["results"]["items"]:
                if "alternatives" in item and len(item["alternatives"]) > 0:
                    item_id = int(item.get("id", 0))
                    # For pronunciation items, include start_time
                    if item["type"] == "pronunciation":
                        items_dict[item_id] = {
                            "content": item["alternatives"][0]["content"],
                            "type": item["type"],
                            "start_time": float(item.get("start_time", "0")),
                            "end_time": float(item.get("end_time", "0")),
                        }
                    else:
                        # For punctuation items, just include content
                        items_dict[item_id] = {
                            "content": item["alternatives"][0]["content"],
                            "type": item["type"],
                        }

            # Build the sequential transcript segment by segment
            output_lines = []

            for idx, segment in enumerate(speaker_segments):
                speaker = segment["speaker_label"]
                segment_start = segment["start_time"]
                segment_end = segment["end_time"]

                # Find all items that belong to this segment
                segment_items = []
                for item_id, item in items_dict.items():
                    if (
                        item["type"] == "pronunciation"
                        and segment_start <= item["start_time"] < segment_end
                    ):
                        segment_items.append((item_id, item))

                # Sort items by start_time
                segment_items.sort(key=lambda x: x[1]["start_time"])

                # Build the text for this segment
                segment_text = []
                for item_id, item in segment_items:
                    if segment_text and item["type"] != "punctuation":
                        segment_text.append(" ")
                    segment_text.append(item["content"])

                    # Add any punctuation that follows this item
                    if (
                        item_id + 1 in items_dict
                        and items_dict[item_id + 1]["type"] == "punctuation"
                    ):
                        segment_text.append(items_dict[item_id + 1]["content"])

                # Add the segment to the transcript if it has content
                if segment_items:
                    segment_id = f"seg_{idx}"
                    text = "".join(segment_text)

                    # Format timestamp
                    h = int(segment_start // 3600)
                    m = int((segment_start % 3600) // 60)
                    s = int(segment_start % 60)
                    timestamp = f"{h:02d}:{m:02d}:{s:02d}"

                    output_lines.append(
                        f"[{segment_id}][{speaker}][{timestamp}] {text}"
                    )

            logger.info(
                f"Successfully converted transcript using speaker_labels with {len(output_lines)} segments (with timestamps)"
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
