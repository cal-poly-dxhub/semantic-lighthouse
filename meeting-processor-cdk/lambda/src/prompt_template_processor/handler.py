import json
import boto3
import os
import uuid
from datetime import datetime
import re
from urllib.parse import unquote
import logging
import time

# Configure logging
logger = logging.getLogger()
logger.setLevel(logging.INFO)

# Initialize AWS clients
s3_client = boto3.client('s3')
textract_client = boto3.client('textract')
bedrock_runtime = boto3.client('bedrock-runtime')
dynamodb = boto3.resource('dynamodb')

# Environment variables
BUCKET_NAME = os.environ['BUCKET_NAME']
PROMPT_TEMPLATES_TABLE_NAME = os.environ['PROMPT_TEMPLATES_TABLE_NAME']
SYSTEM_CONFIG_TABLE_NAME = os.environ['SYSTEM_CONFIG_TABLE_NAME']

# DynamoDB tables
prompt_templates_table = dynamodb.Table(PROMPT_TEMPLATES_TABLE_NAME)
system_config_table = dynamodb.Table(SYSTEM_CONFIG_TABLE_NAME)

def lambda_handler(event, context):
    """
    Process uploaded PDF meeting minutes examples to generate custom prompt templates
    """
    logger.info(f"Received event: {json.dumps(event)}")
    
    try:
        # Extract S3 event details from EventBridge
        detail = event.get('detail', {})
        bucket = detail.get('bucket', {}).get('name')
        object_key = detail.get('object', {}).get('key')
        
        if not bucket or not object_key:
            logger.error("Missing bucket or object key in event")
            return {"statusCode": 400, "body": "Invalid event format"}
        
        # Decode the object key
        object_key = unquote(object_key)
        logger.info(f"Processing file: {object_key} from bucket: {bucket}")
        
        # Verify it's a prompt template upload
        if not object_key.startswith('uploads/prompt_templates/'):
            logger.info("Not a prompt template upload, ignoring")
            return {"statusCode": 200, "body": "Not a prompt template file"}
        
        # Extract template information from the S3 object key
        # Expected format: uploads/prompt_templates/{templateId}_{title}.pdf
        filename = object_key.split('/')[-1]
        if not filename.endswith('.pdf'):
            logger.error(f"Not a PDF file: {filename}")
            return {"statusCode": 400, "body": "Only PDF files are supported"}
        
        # Parse filename to extract templateId and title
        # Format: {templateId}_{title}.pdf
        name_without_ext = filename[:-4]  # Remove .pdf
        parts = name_without_ext.split('_', 1)
        
        if len(parts) != 2:
            logger.error(f"Invalid filename format: {filename}")
            return {"statusCode": 400, "body": "Invalid filename format"}
        
        template_id = parts[0]
        template_title = parts[1].replace('_', ' ')
        
        logger.info(f"Processing template: {template_id} with title: {template_title}")
        
        # Create initial record in DynamoDB with processing status
        current_time = datetime.utcnow().isoformat()
        
        prompt_templates_table.put_item(
            Item={
                'templateId': template_id,
                'createdAt': current_time,
                'title': template_title,
                'status': 'processing',
                'sourceFile': object_key,
                'updatedAt': current_time
            }
        )
        
        # Extract text from PDF using Textract Async API
        logger.info("Starting async Textract analysis")
        
        extracted_text = extract_text_from_pdf_async(bucket, object_key)
        
        if not extracted_text:
            logger.error("No text extracted from PDF")
            update_template_status(template_id, current_time, 'failed', 'No text could be extracted from the PDF')
            return {"statusCode": 400, "body": "No text extracted from PDF"}
        
        logger.info(f"Extracted {len(extracted_text)} characters from PDF")
        
        # Generate custom prompt using Claude
        logger.info("Generating custom prompt with Claude")
        
        custom_prompt = generate_custom_prompt(extracted_text)
        
        if not custom_prompt:
            logger.error("Failed to generate custom prompt")
            update_template_status(template_id, current_time, 'failed', 'Failed to generate custom prompt')
            return {"statusCode": 500, "body": "Failed to generate custom prompt"}
        
        # Validate that the generated prompt contains required placeholders
        if not validate_prompt_placeholders(custom_prompt):
            logger.error("Generated prompt missing required placeholders")
            update_template_status(template_id, current_time, 'failed', 'Generated prompt missing required placeholders: {agenda} and {formatted_transcript}')
            return {"statusCode": 400, "body": "Generated prompt missing required placeholders"}
        
        # Update DynamoDB with the generated prompt
        prompt_templates_table.update_item(
            Key={
                'templateId': template_id,
                'createdAt': current_time
            },
            UpdateExpression='SET #status = :status, customPrompt = :prompt, updatedAt = :updated',
            ExpressionAttributeNames={
                '#status': 'status'
            },
            ExpressionAttributeValues={
                ':status': 'available',
                ':prompt': custom_prompt,
                ':updated': datetime.utcnow().isoformat()
            }
        )
        
        logger.info(f"Successfully processed prompt template: {template_id}")
        
        return {
            "statusCode": 200,
            "body": json.dumps({
                "message": "Prompt template processed successfully",
                "templateId": template_id,
                "title": template_title
            })
        }
        
    except Exception as e:
        logger.error(f"Error processing prompt template: {str(e)}", exc_info=True)
        return {
            "statusCode": 500,
            "body": json.dumps({
                "error": "Internal server error",
                "message": str(e)
            })
        }

def generate_custom_prompt(meeting_minutes_example):
    """
    Generate a custom prompt using Claude based on the example meeting minutes
    """
    try:
        # Get AI configuration from system config table
        prompt_generation_config = get_prompt_generation_config()
        
        # Create the prompt for Claude
        claude_prompt = f"""Go through this transcript for a board meeting. The context of the board meeting should be clear from the agenda and the transcript.I want you to go through this and look for the segments where there is a vote taking place or where there is a topic transition.Refer to the agenda for more info:AGENDA:{{agenda}}TRANSCRIPT:{{formatted_transcript}}I want you to reference specific segments for topic transitions, segments where a vote takes place, which segments refer to which agenda item, etc. Please also mention what each agenda item is about and what the vote was about. Also include what discussions were had about each agenda item and other information. Be very thorough in the discussion of each agenda item and the vote. Be sure to include what things were discussed, debated etc in detail.Please be EXTREMELY comprehensive and specific in your analysis, always referencing segment IDs when discussing parts of the transcript. For the references i want you to use the format [seg_0] or [seg_0-55] if using a range of segments. Above is a prompt which is sent to an llm to generate meeting minutes. I want you to update the prompt and customize it to make it so that it generate meeting minutes similar to the example below. Only return the updated prompt and nothing else. example: {meeting_minutes_example}"""

        # Prepare the request for Claude
        request_body = {
            "anthropic_version": "bedrock-2023-05-31",
            "max_tokens": prompt_generation_config.get('max_tokens', 8000),
            "temperature": prompt_generation_config.get('temperature', 0.1),
            "messages": [
                {
                    "role": "user",
                    "content": claude_prompt
                }
            ]
        }
        
        # Call Claude via Bedrock
        response = bedrock_runtime.invoke_model(
            modelId=prompt_generation_config.get('model_id', 'us.anthropic.claude-sonnet-4-20250514-v1:0'),
            body=json.dumps(request_body),
            contentType='application/json'
        )
        
        response_body = json.loads(response['body'].read())
        custom_prompt = response_body['content'][0]['text'].strip()
        
        logger.info(f"Generated custom prompt with {len(custom_prompt)} characters")
        
        return custom_prompt
        
    except Exception as e:
        logger.error(f"Error generating custom prompt: {str(e)}", exc_info=True)
        return None

def get_prompt_generation_config():
    """
    Get prompt generation configuration from system config table
    """
    try:
        # Default configuration
        config = {
            'model_id': 'us.anthropic.claude-sonnet-4-20250514-v1:0',
            'max_tokens': 8000,
            'temperature': 0.1
        }
        
        # Try to get configuration from DynamoDB
        config_keys = ['prompt_generation_model_id', 'prompt_generation_max_tokens', 'prompt_generation_temperature']
        
        for key in config_keys:
            try:
                response = system_config_table.get_item(Key={'configKey': key})
                if 'Item' in response:
                    value = response['Item']['configValue']
                    if key == 'prompt_generation_model_id':
                        config['model_id'] = value
                    elif key == 'prompt_generation_max_tokens':
                        config['max_tokens'] = int(value)
                    elif key == 'prompt_generation_temperature':
                        config['temperature'] = float(value)
            except Exception as e:
                logger.warning(f"Could not get config for {key}: {str(e)}")
                
        return config
        
    except Exception as e:
        logger.error(f"Error getting prompt generation config: {str(e)}")
        return {
            'model_id': 'us.anthropic.claude-sonnet-4-20250514-v1:0',
            'max_tokens': 8000,
            'temperature': 0.1
        }

def validate_prompt_placeholders(prompt):
    """
    Validate that the generated prompt contains required placeholders
    """
    required_placeholders = ['{agenda}', '{formatted_transcript}']
    
    for placeholder in required_placeholders:
        if placeholder not in prompt:
            logger.warning(f"Missing required placeholder: {placeholder}")
            return False
    
    return True

def update_template_status(template_id, created_at, status, error_message=None):
    """
    Update the status of a prompt template
    """
    try:
        update_expression = 'SET #status = :status, updatedAt = :updated'
        expression_values = {
            ':status': status,
            ':updated': datetime.utcnow().isoformat()
        }
        
        if error_message:
            update_expression += ', errorMessage = :error'
            expression_values[':error'] = error_message
        
        prompt_templates_table.update_item(
            Key={
                'templateId': template_id,
                'createdAt': created_at
            },
            UpdateExpression=update_expression,
            ExpressionAttributeNames={
                '#status': 'status'
            },
            ExpressionAttributeValues=expression_values
        )
        
    except Exception as e:
        logger.error(f"Error updating template status: {str(e)}") 

def extract_text_from_pdf_async(bucket, object_key):
    """
    Extract text from PDF using Textract async API to handle multi-page documents
    """
    try:
        logger.info(f"Starting async Textract job for s3://{bucket}/{object_key}")
        
        # Start the document text detection job
        response = textract_client.start_document_text_detection(
            DocumentLocation={
                'S3Object': {
                    'Bucket': bucket,
                    'Name': object_key
                }
            }
        )
        
        job_id = response['JobId']
        logger.info(f"Started Textract job: {job_id}")
        
        # Poll for job completion
        max_attempts = 60  # 10 minutes max (10 seconds * 60)
        attempt = 0
        
        while attempt < max_attempts:
            attempt += 1
            logger.info(f"Checking Textract job status (attempt {attempt}/{max_attempts})")
            
            result = textract_client.get_document_text_detection(JobId=job_id)
            job_status = result['JobStatus']
            
            logger.info(f"Textract job status: {job_status}")
            
            if job_status == 'SUCCEEDED':
                logger.info("Textract job completed successfully")
                break
            elif job_status == 'FAILED':
                error_msg = f"Textract job failed: {result.get('StatusMessage', 'Unknown error')}"
                logger.error(error_msg)
                return None
            elif job_status == 'IN_PROGRESS':
                logger.info("Textract job still in progress, waiting...")
                time.sleep(10)  # Wait 10 seconds before checking again
            else:
                logger.warning(f"Unexpected job status: {job_status}")
                time.sleep(10)
        
        if attempt >= max_attempts:
            logger.error("Textract job timed out")
            return None
        
        # Extract text from completed job
        logger.info("Extracting text from Textract results")
        extracted_text = ""
        
        # Get all pages of results
        next_token = None
        while True:
            if next_token:
                result = textract_client.get_document_text_detection(
                    JobId=job_id,
                    NextToken=next_token
                )
            else:
                result = textract_client.get_document_text_detection(JobId=job_id)
            
            # Extract text from blocks
            for block in result.get('Blocks', []):
                if block['BlockType'] == 'LINE':
                    extracted_text += block.get('Text', '') + "\n"
            
            # Check if there are more pages
            next_token = result.get('NextToken')
            if not next_token:
                break
            
            logger.info("Getting next page of Textract results...")
        
        logger.info(f"Successfully extracted {len(extracted_text)} characters from PDF")
        return extracted_text.strip()
        
    except Exception as e:
        logger.error(f"Error in async Textract processing: {str(e)}", exc_info=True)
        return None 