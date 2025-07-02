import os
import boto3
import json
import logging
from urllib.parse import urlparse
import datetime
import re
import markdown

# Optional PDF-generation libraries (now handled by separate Lambda)
try:
    import html2text  # type: ignore
    from reportlab.lib.pagesizes import letter, A4  # type: ignore
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle  # type: ignore
    from reportlab.lib.units import inch  # type: ignore
    from reportlab.platypus import (  # type: ignore
        SimpleDocTemplate,
        Paragraph,
        Spacer,
        PageBreak,
    )
    from reportlab.lib.enums import TA_CENTER, TA_JUSTIFY, TA_LEFT  # type: ignore
    from reportlab.lib.colors import HexColor  # type: ignore
except ImportError:
    # These libraries are not required anymore because PDF generation was moved
    html2text = None  # type: ignore

logger = logging.getLogger()
logger.setLevel(logging.INFO)

s3_client = boto3.client("s3")
bedrock_runtime = boto3.client("bedrock-runtime", region_name="us-west-2")


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


def fetch_s3_text_content(bucket, key):
    """Fetch text content from S3."""
    try:
        logger.info(f"Fetching content from s3://{bucket}/{key}")
        response = s3_client.get_object(Bucket=bucket, Key=key)
        content = response["Body"].read().decode("utf-8")
        logger.info(
            f"Successfully fetched {len(content)} characters from s3://{bucket}/{key}"
        )
        return content
    except Exception as e:
        logger.error(f"Error fetching content from s3://{bucket}/{key}: {e}")
        raise e


def analyze_transcript_with_bedrock(
    human_readable_transcript, prompt_template, agenda_text
):
    """
    Use Claude via Bedrock to analyze the transcript using the provided prompt template.
    """
    logger.info("=== Starting Bedrock Analysis ===")

    try:
        # Format the prompt by replacing placeholders
        logger.info("Formatting prompt with agenda and transcript...")
        formatted_prompt = prompt_template.format(
            agenda=agenda_text, formatted_transcript=human_readable_transcript
        )

        logger.info(f"Formatted prompt length: {len(formatted_prompt)} characters")

        # Create the request payload for Claude
        request_body = {
            "anthropic_version": "bedrock-2023-05-31",
            "max_tokens": 8000,
            "temperature": 0.2,
            "messages": [{"role": "user", "content": formatted_prompt}],
        }

        logger.info("Invoking Claude via Bedrock...")

        # Make the streaming API call
        response = bedrock_runtime.invoke_model_with_response_stream(
            modelId="us.anthropic.claude-3-7-sonnet-20250219-v1:0",
            contentType="application/json",
            accept="application/json",
            body=json.dumps(request_body),
        )

        # Process the streaming response
        analysis_chunks = []
        logger.info("Processing Claude's streaming response...")

        # Iterate through the streaming chunks
        for event in response.get("body"):
            if "chunk" in event:
                chunk_data = json.loads(event["chunk"]["bytes"])
                if chunk_data.get("type") == "content_block_delta" and chunk_data.get(
                    "delta", {}
                ).get("text"):
                    text_chunk = chunk_data["delta"]["text"]
                    analysis_chunks.append(text_chunk)

        # Combine all chunks to return the complete analysis
        analysis = "".join(analysis_chunks)
        logger.info(
            f"Bedrock analysis completed successfully. Response length: {len(analysis)} characters"
        )

        return analysis

    except Exception as e:
        logger.error(f"Error during Bedrock analysis: {e}")
        raise e


def process_video_links_for_pdf(text):
    """
    Convert video link markers to ReportLab-compatible hyperlinks.

    Input: "[seg_0]VIDEOLINK[https://video-url#t=00:01:23]ENDLINK"
    Output: "<link href='https://video-url#t=00:01:23'>[seg_0]</link>"
    """
    # Pattern to match: [seg_X]VIDEOLINK[url]ENDLINK
    pattern = r"([^\s]+)VIDEOLINK\[([^\]]+)\]ENDLINK"

    def replace_link(match):
        citation = match.group(1)
        url = match.group(2)
        # ReportLab link format - the citation text becomes clickable
        return f'<link href="{url}">{citation}</link>'

    return re.sub(pattern, replace_link, text)


def process_video_links_for_html(text):
    """
    Convert video link markers to HTML anchor tags.

    Input: "[seg_0]VIDEOLINK[https://video-url#t=00:01:23]ENDLINK"
    Output: "<a href='https://video-url#t=00:01:23' target='_blank'>[seg_0]</a>"
    """
    # Pattern to match: [seg_X]VIDEOLINK[url]ENDLINK
    pattern = r"([^\s]+)VIDEOLINK\[([^\]]+)\]ENDLINK"

    def replace_link(match):
        citation = match.group(1)
        url = match.group(2)
        # HTML anchor tag with target="_blank" to open in new tab
        return f'<a href="{url}" target="_blank" style="color: #3498db; text-decoration: none; font-weight: bold;">{citation}</a>'

    return re.sub(pattern, replace_link, text)


def generate_html_from_analysis(analysis_text, job_name, bucket_name):
    """
    Generate an HTML file from the Bedrock analysis text and save it to S3.

    Args:
        analysis_text (str): The analysis text from Bedrock with video link markers
        job_name (str): The transcription job name for file naming
        bucket_name (str): S3 bucket to save the HTML

    Returns:
        str: S3 key where the HTML was saved
    """
    try:
        logger.info("Starting HTML generation from analysis text...")

        # Process video links for HTML
        html_content = process_video_links_for_html(analysis_text)

        # Convert markdown to HTML
        html_body = markdown.markdown(html_content)

        # Create full HTML document with styling
        html_document = f"""
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Meeting Analysis Report</title>
    <style>
        body {{
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            line-height: 1.6;
            max-width: 800px;
            margin: 0 auto;
            padding: 20px;
            color: #333;
            background-color: #f9f9f9;
        }}
        .container {{
            background-color: white;
            padding: 40px;
            border-radius: 8px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        }}
        h1 {{
            color: #2c3e50;
            text-align: center;
            border-bottom: 3px solid #3498db;
            padding-bottom: 10px;
            margin-bottom: 30px;
        }}
        h2 {{
            color: #3498db;
            margin-top: 30px;
            margin-bottom: 15px;
        }}
        h3 {{
            color: #2c3e50;
            margin-top: 25px;
            margin-bottom: 10px;
        }}
        p {{
            margin-bottom: 15px;
            text-align: justify;
        }}
        a {{
            color: #3498db;
            text-decoration: none;
            font-weight: bold;
            transition: color 0.3s ease;
        }}
        a:hover {{
            color: #e74c3c;
            text-decoration: underline;
        }}
        .metadata {{
            background-color: #ecf0f1;
            padding: 15px;
            border-radius: 5px;
            margin-bottom: 30px;
            font-size: 14px;
        }}
        .footer {{
            text-align: center;
            margin-top: 40px;
            padding-top: 20px;
            border-top: 1px solid #ddd;
            color: #777;
            font-size: 12px;
        }}
        ul, ol {{
            margin-bottom: 15px;
        }}
        li {{
            margin-bottom: 5px;
        }}
    </style>
</head>
<body>
    <div class="container">
        <h1>Meeting Analysis Report</h1>
        
        <div class="metadata">
            <strong>Generated:</strong> {datetime.datetime.now().strftime('%B %d, %Y at %H:%M UTC')}<br>
            <strong>Job Name:</strong> {job_name}
        </div>
        
        {html_body}
        
        <div class="footer">
            <p>© {datetime.datetime.now().year} Meeting Minutes</p>
            <p><em>Click any segment reference (like [seg_0]) to jump to that moment in the video</em></p>
        </div>
    </div>
</body>
</html>
"""

        # Save HTML to S3
        html_key = f"analysis/{job_name}_analysis.html"
        logger.info(f"Saving HTML to s3://{bucket_name}/{html_key}")

        s3_client.put_object(
            Bucket=bucket_name,
            Key=html_key,
            Body=html_document.encode("utf-8"),
            ContentType="text/html",
        )

        logger.info(
            f"Successfully generated and saved HTML: {html_key} ({len(html_document)} characters)"
        )
        return html_key

    except Exception as e:
        logger.error(f"Error generating HTML: {e}")
        raise e


def generate_pdf_from_analysis(analysis_text, job_name, bucket_name):
    """
    Generate a PDF from the Bedrock analysis text using ReportLab and save it to S3.

    Args:
        analysis_text (str): The analysis text from Bedrock
        job_name (str): The transcription job name for file naming
        bucket_name (str): S3 bucket to save the PDF

    Returns:
        str: S3 key where the PDF was saved
    """
    try:
        logger.info("Starting PDF generation from analysis text using ReportLab...")

        # Create a BytesIO buffer to store the PDF
        buffer = BytesIO()

        # Create the PDF document
        doc = SimpleDocTemplate(
            buffer,
            pagesize=A4,
            rightMargin=72,
            leftMargin=72,
            topMargin=72,
            bottomMargin=72,
        )

        # Get the default stylesheet and create custom styles
        styles = getSampleStyleSheet()

        # Define custom styles
        title_style = ParagraphStyle(
            "CustomTitle",
            parent=styles["Heading1"],
            fontSize=24,
            spaceAfter=30,
            alignment=TA_CENTER,
            textColor=HexColor("#2c3e50"),
        )

        heading_style = ParagraphStyle(
            "CustomHeading",
            parent=styles["Heading2"],
            fontSize=16,
            spaceAfter=12,
            spaceBefore=20,
            textColor=HexColor("#3498db"),
            leftIndent=0,
        )

        subheading_style = ParagraphStyle(
            "CustomSubHeading",
            parent=styles["Heading3"],
            fontSize=14,
            spaceAfter=10,
            spaceBefore=15,
            textColor=HexColor("#2c3e50"),
        )

        body_style = ParagraphStyle(
            "CustomBody",
            parent=styles["Normal"],
            fontSize=11,
            spaceAfter=12,
            alignment=TA_JUSTIFY,
            leftIndent=0,
            rightIndent=0,
        )

        # Create the story (content) for the PDF
        story = []

        # Add title
        story.append(Paragraph("Meeting Analysis Report", title_style))
        story.append(Spacer(1, 12))

        # Add metadata
        story.append(
            Paragraph(
                f"<b>Generated:</b> {datetime.datetime.now().strftime('%B %d, %Y at %H:%M UTC')}",
                body_style,
            )
        )
        story.append(Paragraph(f"<b>Job Name:</b> {job_name}", body_style))
        story.append(Spacer(1, 20))

        # Convert markdown to HTML first, then to plain text with some formatting
        html_content = markdown.markdown(analysis_text)

        # Convert HTML to text while preserving some structure
        h = html2text.HTML2Text()
        h.ignore_links = False
        h.body_width = 0  # Don't wrap lines
        converted_text = h.handle(html_content)

        # Process the text line by line to create proper PDF formatting
        lines = converted_text.split("\n")

        for line in lines:
            line = line.strip()
            if not line:
                story.append(Spacer(1, 6))
                continue

            # Check for different types of content and style accordingly
            if line.startswith("# "):
                # Main heading
                text = line[2:].strip()
                story.append(Paragraph(text, heading_style))
            elif line.startswith("## "):
                # Subheading
                text = line[3:].strip()
                story.append(Paragraph(text, subheading_style))
            elif line.startswith("### "):
                # Sub-subheading
                text = line[4:].strip()
                story.append(Paragraph(f"<b>{text}</b>", body_style))
            elif line.startswith("- ") or line.startswith("* "):
                # Bullet point
                text = line[2:].strip()
                story.append(Paragraph(f"• {text}", body_style))
            elif line.startswith("1. ") or (
                len(line) > 2 and line[0].isdigit() and line[1:3] == ". "
            ):
                # Numbered list
                story.append(Paragraph(line, body_style))
            elif line.startswith("**") and line.endswith("**"):
                # Bold text
                text = line[2:-2].strip()
                story.append(Paragraph(f"<b>{text}</b>", body_style))
            else:
                # Regular paragraph
                if len(line) > 0:
                    # Handle bold markdown syntax
                    line = re.sub(r"\*\*(.*?)\*\*", r"<b>\1</b>", line)
                    # Handle italic markdown syntax
                    line = re.sub(r"\*(.*?)\*", r"<i>\1</i>", line)

                    # Handle video link markers and convert to ReportLab hyperlinks
                    line = process_video_links_for_pdf(line)

                    story.append(Paragraph(line, body_style))

        # Add footer
        story.append(Spacer(1, 30))
        footer_style = ParagraphStyle(
            "Footer",
            parent=styles["Normal"],
            fontSize=10,
            alignment=TA_CENTER,
            textColor=HexColor("#777777"),
        )
        story.append(
            Paragraph(
                f"© {datetime.datetime.now().year} Meeting Minutes",
                footer_style,
            )
        )

        # Build the PDF
        doc.build(story)

        # Get the PDF data
        pdf_data = buffer.getvalue()
        buffer.close()

        # Save PDF to S3
        pdf_key = f"analysis/{job_name}_analysis.pdf"
        logger.info(f"Saving PDF to s3://{bucket_name}/{pdf_key}")

        s3_client.put_object(
            Bucket=bucket_name,
            Key=pdf_key,
            Body=pdf_data,
            ContentType="application/pdf",
        )

        logger.info(
            f"Successfully generated and saved PDF: {pdf_key} ({len(pdf_data)} bytes)"
        )
        return pdf_key

    except Exception as e:
        logger.error(f"Error generating PDF: {e}")
        raise e


def handler(event, context):
    """
    Lambda function handler invoked by Step Functions.
    Fetches completed Transcribe job(s) result(s), converts to human-readable format,
    and saves back to S3. Supports both single and chunked (multiple) transcription processing.
    """
    logger.info("=== ProcessTranscript Lambda Started ===")
    logger.info(f"Received event: {json.dumps(event, indent=2)}")

    bucket_name = os.environ["S3_BUCKET"]
    logger.info(f"Using S3 bucket: {bucket_name}")

    try:
        # Check if this is chunked processing or single file processing
        is_chunked = event.get("isChunkedProcessing", False)

        if is_chunked:
            logger.info("=== Processing CHUNKED transcription results ===")
            return handle_chunked_transcription(event, bucket_name)
        else:
            logger.info("=== Processing SINGLE transcription result ===")
            return handle_single_transcription(event, bucket_name)

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

        # Fail the Step Function state on error
        raise e


def handle_single_transcription(event, bucket_name):
    """Handle single (non-chunked) transcription processing - original functionality"""
    # Get transcription result from the Step Function event
    transcription_job = event["transcriptionResult"]["TranscriptionJob"]
    job_name = transcription_job["TranscriptionJobName"]
    job_status = transcription_job["TranscriptionJobStatus"]

    logger.info(f"Processing transcript for job: {job_name}")
    logger.info(f"Job status: {job_status}")

    if job_status != "COMPLETED":
        raise ValueError(f"Transcription job is not completed. Status: {job_status}")

    uri = transcription_job["Transcript"]["TranscriptFileUri"]
    logger.info(f"Transcript URI: {uri}")

    parsed = urlparse(uri)
    logger.info(
        f"Parsed URI - scheme: {parsed.scheme}, netloc: {parsed.netloc}, path: {parsed.path}"
    )

    # Get the key from the URI
    input_key = parsed.path.lstrip("/")
    if parsed.scheme == "https" and input_key.startswith(f"{bucket_name}/"):
        input_key = input_key[len(f"{bucket_name}/") :]
        logger.info(f"Stripped bucket name from HTTPS URL path. New key: {input_key}")

    input_bucket = bucket_name

    logger.info(f"Will fetch transcript from bucket: {input_bucket}, key: {input_key}")

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

    # Get video info from event
    video_info = event.get("originalVideoInfo", {})

    # Continue with analysis and PDF generation
    return process_transcript_analysis(
        human_readable_transcript, job_name, bucket_name, video_info
    )


def handle_chunked_transcription(event, bucket_name):
    """Handle multiple (chunked) transcription processing with merging"""
    transcription_results = event["transcriptionResults"]
    media_convert_result = event["mediaConvertResult"]

    logger.info(f"Processing {len(transcription_results)} transcription chunks")

    # Extract chunk information and sort by chunk order
    chunks_data = []

    for i, result in enumerate(transcription_results):
        transcription_job = result["TranscriptionJob"]
        job_name = transcription_job["TranscriptionJobName"]
        job_status = transcription_job["TranscriptionJobStatus"]

        logger.info(f"Processing chunk {i+1}: {job_name} (status: {job_status})")

        if job_status != "COMPLETED":
            raise ValueError(
                f"Transcription job {job_name} is not completed. Status: {job_status}"
            )

        # Extract chunk number from job name (format: transcribe-{execution}-{index})
        chunk_index = i  # Fallback to array index
        if "-" in job_name:
            try:
                chunk_index = int(job_name.split("-")[-1])
            except ValueError:
                logger.warning(
                    f"Could not extract chunk index from job name {job_name}, using array index {i}"
                )

        # Get chunk timing information from MediaConvert metadata
        chunk_start_time = 0
        chunk_duration = 0

        # Try to get chunk info from MediaConvert job metadata
        job_ids = media_convert_result["Payload"]["job_ids"]
        if i < len(job_ids):
            try:
                # This would require getting the MediaConvert job details
                # For now, calculate based on chunk index and standard duration
                chunk_start_time = (
                    chunk_index * 4 * 3600
                )  # 4 hours per chunk in seconds
                chunk_duration = 4 * 3600  # 4 hours in seconds
                logger.info(
                    f"Calculated chunk {chunk_index} start time: {chunk_start_time}s"
                )
            except Exception as e:
                logger.warning(
                    f"Could not determine chunk timing from MediaConvert metadata: {e}"
                )

        uri = transcription_job["Transcript"]["TranscriptFileUri"]
        parsed = urlparse(uri)
        input_key = parsed.path.lstrip("/")

        if parsed.scheme == "https" and input_key.startswith(f"{bucket_name}/"):
            input_key = input_key[len(f"{bucket_name}/") :]

        chunks_data.append(
            {
                "chunk_index": chunk_index,
                "job_name": job_name,
                "transcript_key": input_key,
                "chunk_start_time": chunk_start_time,
                "chunk_duration": chunk_duration,
            }
        )

    # Sort chunks by index to ensure proper order
    chunks_data.sort(key=lambda x: x["chunk_index"])

    logger.info("Fetching and merging all transcript chunks...")

    # Fetch all transcript files
    chunk_transcripts = []
    for chunk in chunks_data:
        logger.info(
            f"Fetching transcript for chunk {chunk['chunk_index']}: {chunk['transcript_key']}"
        )
        response = s3_client.get_object(Bucket=bucket_name, Key=chunk["transcript_key"])
        transcript_data = json.loads(response["Body"].read().decode("utf-8"))

        chunk_transcripts.append(
            {
                "data": transcript_data,
                "chunk_index": chunk["chunk_index"],
                "chunk_start_time": chunk["chunk_start_time"],
                "job_name": chunk["job_name"],
            }
        )

    # Merge transcripts with timestamp adjustment
    logger.info("Merging transcripts with timestamp adjustment...")
    merged_transcript = merge_chunked_transcripts(chunk_transcripts)

    # Use the first job name as base for output files
    base_job_name = (
        chunks_data[0]["job_name"].replace("-0", "").replace("-1", "") + "-merged"
    )

    # Get video info from event
    video_info = event.get("originalVideoInfo", {})

    # Continue with analysis and PDF generation
    return process_transcript_analysis(
        merged_transcript, base_job_name, bucket_name, video_info
    )


def merge_chunked_transcripts(chunk_transcripts):
    """
    Merge multiple transcript chunks into a single human-readable transcript
    with proper timestamp adjustment and speaker label consistency
    """
    logger.info(f"Merging {len(chunk_transcripts)} transcript chunks")

    all_segments = []
    global_segment_counter = 0
    speaker_mapping = {}  # Map chunk-specific speaker labels to global labels
    global_speaker_counter = 0

    for chunk in chunk_transcripts:
        chunk_index = chunk["chunk_index"]
        chunk_start_time = chunk["chunk_start_time"]
        transcript_data = chunk["data"]

        logger.info(
            f"Processing chunk {chunk_index} with start time offset {chunk_start_time}s"
        )

        # Convert this chunk to human-readable format first
        chunk_readable = convert_to_human_readable(transcript_data)

        # Parse the human-readable format to extract segments
        # Format: [seg_X][speaker_label][HH:MM:SS] spoken text
        segment_pattern = r"\[([^\]]+)\]\[([^\]]+)\]\[([^\]]+)\] (.+)"

        for line in chunk_readable.split("\n"):
            line = line.strip()
            if not line:
                continue

            match = re.match(segment_pattern, line)
            if match:
                seg_id, speaker, timestamp, text = match.groups()

                # Parse timestamp
                time_parts = timestamp.split(":")
                if len(time_parts) == 3:
                    hours, minutes, seconds = map(int, time_parts)
                    segment_time_seconds = hours * 3600 + minutes * 60 + seconds

                    # Adjust timestamp for chunk offset
                    adjusted_time_seconds = segment_time_seconds + chunk_start_time

                    # Convert back to timestamp format
                    adj_hours = int(adjusted_time_seconds // 3600)
                    adj_minutes = int((adjusted_time_seconds % 3600) // 60)
                    adj_seconds = int(adjusted_time_seconds % 60)
                    adjusted_timestamp = (
                        f"{adj_hours:02d}:{adj_minutes:02d}:{adj_seconds:02d}"
                    )

                    # Handle speaker label consistency across chunks
                    chunk_speaker_key = f"chunk_{chunk_index}_{speaker}"
                    if chunk_speaker_key not in speaker_mapping:
                        speaker_mapping[chunk_speaker_key] = (
                            f"spk_{global_speaker_counter}"
                        )
                        global_speaker_counter += 1

                    global_speaker = speaker_mapping[chunk_speaker_key]

                    # Create the adjusted segment
                    adjusted_segment = f"[seg_{global_segment_counter}][{global_speaker}][{adjusted_timestamp}] {text}"
                    all_segments.append(adjusted_segment)
                    global_segment_counter += 1
                else:
                    logger.warning(f"Could not parse timestamp: {timestamp}")

    merged_transcript = "\n".join(all_segments)

    logger.info(
        f"Successfully merged {len(all_segments)} segments from {len(chunk_transcripts)} chunks"
    )
    logger.info(f"Total speakers identified: {global_speaker_counter}")

    return merged_transcript


def build_segment_timestamp_mapping(human_readable_transcript):
    """
    Parse human-readable transcript to create segment_id -> timestamp mapping

    Input: "[seg_0][spk_0][00:01:23] Hello everyone..."
    Output: {"seg_0": "00:01:23", "seg_1": "00:01:45", ...}
    """
    segment_mapping = {}

    # Pattern to match: [seg_X][speaker][HH:MM:SS] text
    segment_pattern = r"\[seg_(\d+)\]\[[^\]]+\]\[([^\]]+)\] (.+)"

    for line in human_readable_transcript.split("\n"):
        line = line.strip()
        if not line:
            continue

        match = re.match(segment_pattern, line)
        if match:
            seg_number = match.group(1)
            timestamp = match.group(2)
            seg_id = f"seg_{seg_number}"
            segment_mapping[seg_id] = timestamp

    logger.info(f"Built segment mapping with {len(segment_mapping)} segments")
    return segment_mapping


def parse_segment_references(text):
    """
    Find all segment references in text and extract the segments they refer to

    Patterns to match:
    - [seg_0] → ["seg_0"]
    - [seg_1-2] → ["seg_1", "seg_2"]
    - [seg_5-seg_6] → ["seg_5", "seg_6"]
    """

    # Pattern 1: Single segment [seg_X]
    single_pattern = r"\[seg_(\d+)\]"

    # Pattern 2: Range format [seg_X-Y]
    range_pattern1 = r"\[seg_(\d+)-(\d+)\]"

    # Pattern 3: Range format [seg_X-seg_Y]
    range_pattern2 = r"\[seg_(\d+)-seg_(\d+)\]"

    references = []

    # Find single segments
    for match in re.finditer(single_pattern, text):
        seg_num = match.group(1)
        references.append(
            {
                "original": match.group(0),
                "segments": [f"seg_{seg_num}"],
                "start": match.start(),
                "end": match.end(),
            }
        )

    # Find range segments (format 1: seg_X-Y)
    for match in re.finditer(range_pattern1, text):
        start_seg = int(match.group(1))
        end_seg = int(match.group(2))
        segments = [f"seg_{i}" for i in range(start_seg, end_seg + 1)]
        references.append(
            {
                "original": match.group(0),
                "segments": segments,
                "start": match.start(),
                "end": match.end(),
            }
        )

    # Find range segments (format 2: seg_X-seg_Y)
    for match in re.finditer(range_pattern2, text):
        start_seg = int(match.group(1))
        end_seg = int(match.group(2))
        segments = [f"seg_{i}" for i in range(start_seg, end_seg + 1)]
        references.append(
            {
                "original": match.group(0),
                "segments": segments,
                "start": match.start(),
                "end": match.end(),
            }
        )

    # Remove overlapping matches (keep longer/more specific ones)
    # Sort by start position and remove overlaps
    references.sort(key=lambda x: (x["start"], -(x["end"] - x["start"])))
    filtered_references = []
    last_end = -1

    for ref in references:
        if ref["start"] >= last_end:
            filtered_references.append(ref)
            last_end = ref["end"]

    logger.info(f"Found {len(filtered_references)} segment references in text")
    return filtered_references


def generate_video_url_with_timestamp(bucket, key, timestamp_str):
    """
    Create presigned URL with timestamp fragment

    Input: bucket, key, "00:01:23"
    Output: "https://s3.../video.mp4?AWS...#t=00:01:23"
    """
    try:
        # Generate presigned URL (24 hours expiration)
        presigned_url = s3_client.generate_presigned_url(
            "get_object",
            Params={"Bucket": bucket, "Key": key},
            ExpiresIn=86400,  # 24 hours
        )

        # Add timestamp fragment
        video_url_with_timestamp = f"{presigned_url}#t={timestamp_str}"

        return video_url_with_timestamp

    except Exception as e:
        logger.error(f"Failed to generate video URL with timestamp: {e}")
        return None


def replace_segment_citations_with_links(analysis_text, segment_mapping, bucket, key):
    """
    Replace [seg_X] references with special markers for video links that will be processed during PDF generation

    Input: "The meeting started in [seg_0] with roll call"
    Output: "The meeting started in [seg_0]VIDEOLINK[https://video.com#t=00:01:23]ENDLINK with roll call"

    The special markers will be converted to clean clickable links in the PDF.
    """
    try:
        # Get all segment references in the text
        references = parse_segment_references(analysis_text)

        if not references:
            logger.info("No segment references found in analysis text")
            return analysis_text

        # Process references in reverse order to maintain string positions
        modified_text = analysis_text

        for ref in reversed(references):
            original_citation = ref["original"]
            segments = ref["segments"]

            # Use the timestamp of the first segment in the range
            first_segment = segments[0]

            if first_segment in segment_mapping:
                timestamp = segment_mapping[first_segment]
                video_url = generate_video_url_with_timestamp(bucket, key, timestamp)

                if video_url:
                    # Use a special marker format that won't be converted by html2text
                    # We'll process this during PDF generation to create proper ReportLab links
                    link_text = f"{original_citation}VIDEOLINK[{video_url}]ENDLINK"

                    # Replace in text
                    start_pos = ref["start"]
                    end_pos = ref["end"]
                    modified_text = (
                        modified_text[:start_pos] + link_text + modified_text[end_pos:]
                    )

                    logger.info(
                        f"Replaced {original_citation} with video link at {timestamp}"
                    )
                else:
                    logger.warning(
                        f"Failed to generate video URL for {original_citation}"
                    )
            else:
                logger.warning(
                    f"No timestamp found for segment {first_segment} in citation {original_citation}"
                )

        logger.info(f"Successfully processed {len(references)} segment references")
        return modified_text

    except Exception as e:
        logger.error(f"Error replacing segment citations with links: {e}")
        return analysis_text  # Return original text if processing fails


def process_transcript_analysis(
    human_readable_transcript, job_name, bucket_name, video_info=None
):
    """
    Common function to handle transcript analysis and PDF generation
    """
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

    logger.info("Human-readable transcript saved successfully")

    # === BUILD SEGMENT MAPPING ===
    logger.info("=== Building segment timestamp mapping ===")
    segment_mapping = build_segment_timestamp_mapping(human_readable_transcript)

    # === BEDROCK ANALYSIS SECTION ===
    logger.info("=== Starting Bedrock Analysis Phase ===")

    analysis_error = None
    try:
        # Fetch prompt template and agenda from external S3 bucket
        external_bucket = "k12-temp-testing-static-files"
        prompt_key = "detailed_prompt.txt"
        agenda_key = "agenda.txt"

        logger.info("Fetching prompt template and agenda from external S3 bucket...")
        prompt_template = fetch_s3_text_content(external_bucket, prompt_key)
        agenda_text = fetch_s3_text_content(external_bucket, agenda_key)

        # Perform Bedrock analysis
        logger.info("Performing Bedrock analysis...")
        analysis_result = analyze_transcript_with_bedrock(
            human_readable_transcript, prompt_template, agenda_text
        )

        # === ADD VIDEO HYPERLINKS ===
        logger.info("=== Adding video hyperlinks to segment citations ===")
        if video_info and segment_mapping:
            video_bucket = video_info.get("bucket")
            video_key = video_info.get("key")

            if video_bucket and video_key:
                logger.info(f"Adding video links for s3://{video_bucket}/{video_key}")
                analysis_result = replace_segment_citations_with_links(
                    analysis_result, segment_mapping, video_bucket, video_key
                )
                logger.info("Video hyperlinks added successfully")
            else:
                logger.warning("Video info incomplete - skipping video hyperlinks")
        else:
            logger.warning(
                "No video info or segment mapping - skipping video hyperlinks"
            )

        # Save analysis result to S3
        analysis_key = f"analysis/{job_name}_analysis.txt"
        logger.info(f"Saving analysis result to s3://{bucket_name}/{analysis_key}")

        s3_client.put_object(
            Bucket=bucket_name,
            Key=analysis_key,
            Body=analysis_result.encode("utf-8"),
            ContentType="text/plain",
        )

        logger.info("=== Bedrock Analysis Completed Successfully ===")

        # Generate HTML only (PDF will be produced by HtmlToPdfFunction)
        logger.info("=== Starting HTML Generation ===")

        # PDF generation is deferred to separate Lambda in all cases
        pdf_success = False
        pdf_key = None
        pdf_error = "PDF generation handled by HtmlToPdfFunction"

        try:
            html_key = generate_html_from_analysis(
                analysis_result, job_name, bucket_name
            )
            logger.info(f"=== HTML Generation Completed Successfully: {html_key} ===")
            html_success = True
            html_error = None
        except Exception as html_e:
            logger.error("=== HTML Generation FAILED ===")
            logger.error(f"HTML error: {html_e}")
            html_success = False
            html_key = None
            html_error = html_e

        analysis_success = True
        analysis_error = None

    except Exception as e:
        logger.error(f"=== Bedrock Analysis FAILED ===")
        logger.error(f"Analysis error: {e}")
        logger.error(f"Analysis error traceback:", exc_info=True)

        analysis_success = False
        analysis_key = None
        analysis_result = None
        analysis_error = e

        # Set HTML generation as not attempted; PDF handled elsewhere
        html_success = False
        html_key = None
        html_error = "HTML generation skipped due to analysis failure"

        pdf_success = False
        pdf_key = None
        pdf_error = "PDF generation handled by HtmlToPdfFunction"

    logger.info("=== ProcessTranscript Lambda Completed ===")
    logger.info(
        f"Human-readable transcript saved to: s3://{bucket_name}/{human_readable_key}"
    )

    result = {
        "statusCode": 200,
        "message": "Transcript processing completed successfully",
        "humanReadableKey": human_readable_key,
        "transcriptLength": len(human_readable_transcript),
        "analysisCompleted": analysis_success,
        "htmlGenerated": html_success,
        "pdfGenerated": pdf_success,
    }

    if analysis_success:
        result["analysisKey"] = analysis_key
        result["analysisLength"] = len(analysis_result)
        logger.info(f"Analysis saved to: s3://{bucket_name}/{analysis_key}")

        # Include HTML file information
        if html_success:
            result["htmlKey"] = html_key
            result["htmlS3Uri"] = f"s3://{bucket_name}/{html_key}"
            logger.info(f"HTML saved to: s3://{bucket_name}/{html_key}")
        else:
            result["htmlError"] = str(html_error)
            logger.warning("HTML generation failed but analysis succeeded")

        # Include PDF file information
        # PDF will be generated by downstream Lambda
        result["pdfGenerated"] = False
    else:
        result["analysisError"] = str(analysis_error)
        result["htmlError"] = str(html_error)
        result["pdfError"] = str(pdf_error)
        logger.warning("Analysis failed but transcript processing succeeded")

    return result
