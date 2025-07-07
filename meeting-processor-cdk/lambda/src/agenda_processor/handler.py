import json
import boto3
import logging
import os
import time
from urllib.parse import urlparse
from botocore.config import Config
import re

# Set up logging
logger = logging.getLogger()
logger.setLevel(logging.INFO)

# Initialize AWS clients
s3_client = boto3.client("s3")
textract_client = boto3.client("textract")
bedrock_runtime = boto3.client(
    "bedrock-runtime",
    region_name="us-west-2",
    # High timeout to handle increased response times for large payloads
    config=Config(connect_timeout=30, read_timeout=300, retries={"max_attempts": 3}),
)


# Configuration
SONNET_MODEL_ID = "us.anthropic.claude-sonnet-4-20250514-v1:0"
MAX_TEXTRACT_WAIT_TIME = 15 * 60  # 15 minutes
TEXTRACT_POLL_INTERVAL = 30  # Poll every 30 seconds


def extract_correlation_key(s3_key):
    """
    Extract correlation key from S3 key
    uploads/agenda_documents/board_meeting_2024_01_15.pdf -> board_meeting_2024_01_15
    """
    filename = s3_key.split("/")[-1]  # Get filename
    base_name = os.path.splitext(filename)[0]  # Remove extension
    return base_name


def check_s3_object_exists(bucket, key):
    """Check if an S3 object exists"""
    try:
        s3_client.head_object(Bucket=bucket, Key=key)
        return True
    except s3_client.exceptions.NoSuchKey:
        return False
    except Exception as e:
        logger.error(f"Error checking S3 object {bucket}/{key}: {e}")
        return False


def check_for_corresponding_video(bucket, correlation_key):
    """
    Check if corresponding video file exists
    Example of pair:
    agenda_key: uploads/agenda_documents/board_meeting_2024_01_15.pdf
    video_key: uploads/meeting_recordings/board_meeting_2024_01_15.mp4
    """
    video_key = f"uploads/meeting_recordings/{correlation_key}.mp4"
    video_exists = check_s3_object_exists(bucket, video_key)

    return {
        "video_exists": video_exists,
        "video_key": video_key if video_exists else None,
        "correlation_key": correlation_key,
    }


def start_textract_job(bucket, pdf_key):
    """Start Textract document text detection job (simple OCR)"""
    try:
        logger.info(f"Starting Textract job for s3://{bucket}/{pdf_key}")

        response = textract_client.start_document_text_detection(
            DocumentLocation={"S3Object": {"Bucket": bucket, "Name": pdf_key}}
        )

        job_id = response["JobId"]
        logger.info(f"Textract job started with ID: {job_id}")
        return job_id

    except Exception as e:
        logger.error(f"Error starting Textract job: {e}")
        raise


def poll_textract_job(job_id):
    """Poll Textract job until completion"""
    logger.info(f"Polling Textract job {job_id}")

    start_time = time.time()

    while True:
        try:
            response = textract_client.get_document_text_detection(JobId=job_id)
            job_status = response["JobStatus"]

            logger.info(f"Textract job {job_id} status: {job_status}")

            if job_status == "SUCCEEDED":
                return extract_text_from_textract_response(response, job_id)
            elif job_status == "FAILED":
                raise Exception(f"Textract job {job_id} failed")
            elif job_status in ["IN_PROGRESS"]:
                # Check if we've exceeded max wait time
                if time.time() - start_time > MAX_TEXTRACT_WAIT_TIME:
                    raise Exception(f"Textract job {job_id} exceeded maximum wait time")

                # Wait before polling again
                time.sleep(TEXTRACT_POLL_INTERVAL)
            else:
                raise Exception(f"Unexpected Textract job status: {job_status}")

        except Exception as e:
            logger.error(f"Error polling Textract job {job_id}: {e}")
            raise


def extract_text_from_textract_response(response, job_id):
    """Extract all text from Textract response, handling pagination"""
    extracted_text = []

    # Process first page of results
    if "Blocks" in response:
        for block in response["Blocks"]:
            if block["BlockType"] == "LINE":
                extracted_text.append(block["Text"])

    # Handle pagination
    next_token = response.get("NextToken")
    while next_token:
        try:
            response = textract_client.get_document_text_detection(
                JobId=job_id, NextToken=next_token
            )

            if "Blocks" in response:
                for block in response["Blocks"]:
                    if block["BlockType"] == "LINE":
                        extracted_text.append(block["Text"])

            next_token = response.get("NextToken")

        except Exception as e:
            logger.error(f"Error getting paginated Textract results: {e}")
            break

    full_text = "\n".join(extracted_text)
    logger.info(f"Extracted {len(full_text)} characters of text from PDF")
    return full_text


def load_prompt_template():
    """Load the agenda analysis prompt from file"""
    try:
        # Get the directory where this script is located
        script_dir = os.path.dirname(os.path.abspath(__file__))
        prompt_file_path = os.path.join(script_dir, "agenda_analysis_prompt.txt")
        logger.info(f"Loading prompt template from {prompt_file_path}")
        with open(prompt_file_path, "r", encoding="utf-8") as f:
            prompt_template = f.read()
            logger.info(f"Prompt template: {prompt_template}")
            return prompt_template
    except Exception as e:
        logger.error(f"Error loading prompt template: {e}")
        # Fallback to a basic prompt if file can't be loaded
        return """You are an expert at analyzing meeting agenda documents. 
        
AGENDA DOCUMENT:
{agenda_text}

Please analyze this agenda and provide a structured JSON summary with meeting metadata, participants, agenda items, key documents, action items expected, and background context."""


def analyze_agenda(agenda_text):
    """Analyze agenda text and extract structured information"""
    logger.info(f"Starting agenda analysis using model {SONNET_MODEL_ID}")

    # Load the prompt template and substitute the agenda text
    prompt_template = load_prompt_template()
    prompt = prompt_template.format(agenda_text=agenda_text)

    try:
        # Create conversation for the model
        conversation = [
            {
                "role": "user",
                "content": [{"text": prompt}],
            }
        ]

        logger.info(f"Sending {len(agenda_text)} characters to model {SONNET_MODEL_ID}")

        response = bedrock_runtime.converse(
            modelId=SONNET_MODEL_ID,
            messages=conversation,
            inferenceConfig={"maxTokens": 65535, "temperature": 0.1, "topP": 0.9},
        )

        # Extract the response text
        analysis_text = response["output"]["message"]["content"][0]["text"]

        logger.info(f"Agenda analysis completed using model {SONNET_MODEL_ID}")
        logger.info(f"Analysis response length: {len(analysis_text)} characters")

        # Try to parse as JSON
        try:
            analysis_json = extract_json_from_llm_response(analysis_text)
            logger.info(f"Parsed JSON: {analysis_json}")
            return analysis_json
        except Exception as e:
            logger.warning(f"Model {SONNET_MODEL_ID} response could not be parsed: {e}")
            # Return a fallback structure with the raw text to keep pipeline alive
            return {
                "error": "Invalid JSON response",
                "raw_response": analysis_text,
                "meeting_metadata": {},
                "participants": [],
                "agenda_items": [],
                "key_documents": [],
                "action_items_expected": [],
                "background_context": "Failed to parse agenda analysis",
            }

    except Exception as e:
        logger.error(f"Error in agenda analysis using model {SONNET_MODEL_ID}: {e}")
        raise


def save_results_to_s3(bucket, correlation_key, raw_text, analysis_json):
    """Save processing results to S3"""
    try:
        # Save raw text
        raw_text_key = f"processed/agenda/raw_text/{correlation_key}.txt"
        s3_client.put_object(
            Bucket=bucket,
            Key=raw_text_key,
            Body=raw_text.encode("utf-8"),
            ContentType="text/plain",
        )
        logger.info(f"Saved raw text to s3://{bucket}/{raw_text_key}")

        # Save analysis JSON
        analysis_key = f"processed/agenda/analysis/{correlation_key}.json"
        s3_client.put_object(
            Bucket=bucket,
            Key=analysis_key,
            Body=json.dumps(analysis_json, indent=2).encode("utf-8"),
            ContentType="application/json",
        )
        logger.info(f"Saved analysis to s3://{bucket}/{analysis_key}")

        return {
            "raw_text_s3_uri": f"s3://{bucket}/{raw_text_key}",
            "analysis_s3_uri": f"s3://{bucket}/{analysis_key}",
        }

    except Exception as e:
        logger.error(f"Error saving results to S3: {e}")
        raise


# ------------------------------------------------------------
# Helper: robust JSON extraction from LLM responses
# ------------------------------------------------------------


def extract_json_from_llm_response(response_text: str):
    """Extract JSON content from an LLM string that might be wrapped in
    markdown code-blocks or contain explanatory text.

    Lightweight and dependency-free so it is Lambda-friendly.
    Raises ValueError if parsing ultimately fails.
    """

    if not response_text:
        raise ValueError("Empty response text from model")

    # 1. Strip triple-backtick code fences (``` or ```json)
    text = re.sub(r"```json\s*", "", response_text, flags=re.IGNORECASE)
    text = re.sub(r"```", "", text)

    # 2. Remove common leading phrases before the JSON starts
    prefixes = [
        r"^.*?here\s+is\s+the\s+json:?\s*",
        r"^.*?json\s+response:?\s*",
        r"^.*?result:?\s*",
    ]
    for pattern in prefixes:
        text = re.sub(pattern, "", text, flags=re.IGNORECASE | re.DOTALL)

    # 3. Grab the first JSON object in the string
    json_match = re.search(r"\{.*\}", text, flags=re.DOTALL)
    if json_match:
        json_str = json_match.group(0)
    else:
        json_str = text.strip()

    # 4. Remove trailing commas before an object/array close
    json_str = re.sub(r",(\s*[}\]])", r"\1", json_str)

    # 5. Attempt to parse – try progressively simpler clean-ups
    attempts = [json_str, json_str.replace("\n", " "), re.sub(r"\s+", " ", json_str)]
    last_err = None
    for attempt in attempts:
        try:
            return json.loads(attempt)
        except json.JSONDecodeError as exc:
            last_err = exc
            continue

    raise ValueError(f"Failed to parse JSON. Last error: {last_err}")


def lambda_handler(event, context):
    """
    Main Lambda handler for agenda processing

    Expected input from EventBridge S3 event:
    {
        "detail": {
            "bucket": {"name": "bucket-name"},
            "object": {"key": "uploads/agenda_documents/filename.pdf"}
        }
    }
    """
    logger.info("=== AgendaProcessor Lambda Started ===")
    logger.info(f"Received event: {json.dumps(event, indent=2)}")

    try:
        # Extract S3 information from event
        bucket_name = event["detail"]["bucket"]["name"]
        pdf_key = event["detail"]["object"]["key"]

        logger.info(f"Processing agenda: s3://{bucket_name}/{pdf_key}")

        # Extract correlation key
        correlation_key = extract_correlation_key(pdf_key)
        logger.info(f"Correlation key: {correlation_key}")

        # ------------------------------------------------------------------
        # TEST MODE: skip Textract and call analysis directly
        # ------------------------------------------------------------------
        if os.environ.get("TEST_AI_ONLY", "false").lower() == "true":
            logger.info(
                "TEST_AI_ONLY enabled – skipping Textract and testing analysis function"
            )

            test_prompt = "What country has Baghdad as its capital?"

            # Call analysis function with test prompt
            agenda_analysis = analyze_agenda(test_prompt)

            # Return immediately with the analysis response
            result = {
                "statusCode": 200,
                "success": True,
                "test_mode": True,
                "prompt": test_prompt,
                "agenda_analysis": agenda_analysis,
            }

            logger.info("Test mode result: %s", json.dumps(result, indent=2))
            return result

        # Check for corresponding video
        video_info = check_for_corresponding_video(bucket_name, correlation_key)
        logger.info(f"Video check result: {video_info}")

        # Start Textract job
        textract_job_id = start_textract_job(bucket_name, pdf_key)

        # Poll for completion and extract text
        extracted_text = poll_textract_job(textract_job_id)

        # Analyze extracted text
        agenda_analysis = analyze_agenda(extracted_text)

        # Save results to S3
        s3_uris = save_results_to_s3(
            bucket_name, correlation_key, extracted_text, agenda_analysis
        )

        # Check if we should trigger combined processing
        if video_info["video_exists"]:
            logger.info("Corresponding video found - triggering combined processing")
            try:
                # Trigger the video processing state machine with agenda data
                step_functions_client = boto3.client("stepfunctions")

                # Get the state machine ARN from environment or construct it
                # Note: You'll need to add this environment variable to the CDK
                state_machine_arn = os.environ.get("STATE_MACHINE_ARN")
                if not state_machine_arn:
                    # Fallback construction - this should be set via environment variable
                    region = os.environ.get("AWS_REGION", "us-west-2")
                    account_id = boto3.client("sts").get_caller_identity()["Account"]
                    state_machine_arn = f"arn:aws:states:{region}:{account_id}:stateMachine:meeting-processor-transcription-v2"

                # Create the event payload for the video processing
                video_event = {
                    "detail": {
                        "bucket": {"name": bucket_name},
                        "object": {"key": video_info["video_key"]},
                    },
                    "agendaData": {
                        "agenda_exists": True,
                        "analysis_s3_uri": s3_uris["analysis_s3_uri"],
                        "raw_text_s3_uri": s3_uris["raw_text_s3_uri"],
                        "analysis_data": agenda_analysis,
                        "correlation_key": correlation_key,
                    },
                }

                # Start the state machine execution
                execution_name = (
                    f"combined-processing-{correlation_key}-{int(time.time())}"
                )

                response = step_functions_client.start_execution(
                    stateMachineArn=state_machine_arn,
                    name=execution_name,
                    input=json.dumps(video_event),
                )

                logger.info(
                    f"Started combined processing execution: {response['executionArn']}"
                )

                combined_processing_triggered = True
                execution_arn = response["executionArn"]

            except Exception as e:
                logger.error(f"Failed to trigger combined processing: {e}")
                combined_processing_triggered = False
                execution_arn = None
        else:
            logger.info("No corresponding video found - agenda analysis completed")
            combined_processing_triggered = False
            execution_arn = None

        # Prepare response
        result = {
            "statusCode": 200,
            "success": True,
            "correlation_key": correlation_key,
            "agenda_analysis": agenda_analysis,
            "s3_uris": s3_uris,
            "corresponding_video": video_info,
            "textract_job_id": textract_job_id,
            "characters_extracted": len(extracted_text),
            "combined_processing_triggered": combined_processing_triggered,
            "execution_arn": execution_arn,
        }

        logger.info("=== AgendaProcessor Lambda Completed Successfully ===")
        logger.info(
            f"Processed {len(extracted_text)} characters, found {len(agenda_analysis.get('agenda_items', []))} agenda items"
        )
        if combined_processing_triggered:
            logger.info("Combined processing with video has been triggered")

        return result

    except Exception as e:
        logger.error("=== AgendaProcessor Lambda FAILED ===")
        logger.error(f"Error type: {type(e).__name__}")
        logger.error(f"Error message: {str(e)}")
        logger.error(f"Full traceback:", exc_info=True)

        return {
            "statusCode": 500,
            "success": False,
            "error": str(e),
            "correlation_key": locals().get("correlation_key", "unknown"),
        }
