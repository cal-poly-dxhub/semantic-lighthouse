import os
import boto3
import json
import logging

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
    logger.info("Received event: %s", json.dumps(event))

    bucket_name = os.environ["S3_BUCKET"]

    try:
        # Get transcription result from the Step Function event
        transcription_job = event["transcriptionResult"]["TranscriptionJob"]
        job_name = transcription_job["TranscriptionJobName"]

        transcript_uri = transcription_job["Transcript"]["TranscriptFileUri"]

        # Parse bucket and key from the transcript URI
        uri_path = transcript_uri.split(f"s3://")[1]
        transcript_bucket, transcript_key = uri_path.split("/", 1)

        logger.info(
            f"Processing transcript for job: {job_name} from {transcript_bucket}/{transcript_key}"
        )

        # Get the transcript JSON from S3
        response = s3_client.get_object(Bucket=transcript_bucket, Key=transcript_key)
        transcript_data = json.loads(response["Body"].read().decode("utf-8"))

        # Convert to human-readable format
        human_readable_text = convert_to_human_readable(transcript_data)

        # Save human-readable version to S3
        human_readable_key = f"transcripts/{job_name}_human_readable.txt"

        s3_client.put_object(
            Bucket=bucket_name,
            Key=human_readable_key,
            Body=human_readable_text.encode("utf-8"),
            ContentType="text/plain",
        )
        logger.info(
            f"Saved human-readable transcript to s3://{bucket_name}/{human_readable_key}"
        )

        return {
            "statusCode": 200,
            "message": "Transcript processing completed successfully",
            "humanReadableKey": human_readable_key,
        }

    except Exception as e:
        logger.error(f"Unexpected error in transcript processing: {e}")
        # Fail the Step Function state on error
        raise e
