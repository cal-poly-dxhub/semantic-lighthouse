import json
import boto3
import logging
import os
from urllib.parse import urlparse

# Set up logging
logger = logging.getLogger()
logger.setLevel(logging.INFO)

# Initialize AWS clients
s3_client = boto3.client("s3")
sns_client = boto3.client("sns")
dynamodb_client = boto3.client("dynamodb")

# Configuration
PRESIGNED_URL_EXPIRATION = 7 * 24 * 60 * 60  # 7 days


def get_meeting_info_from_s3_uri(s3_uri):
    """Extract meeting information from S3 URI to get the meetingId."""
    try:
        parsed_uri = urlparse(s3_uri)
        bucket_name = parsed_uri.netloc
        s3_key = parsed_uri.path.lstrip('/')
        
        # S3 key format: analysis/{job_name}_analysis.html or analysis/{job_name}_analysis.pdf
        # Job name format includes meetingId, so extract it
        if '/analysis/' in s3_key and '_analysis.' in s3_key:
            # Extract job name from path like "analysis/meeting-abc123-def456_analysis.html"
            filename = s3_key.split('/')[-1]  # Get filename
            job_name = filename.split('_analysis.')[0]  # Remove "_analysis.html" or "_analysis.pdf"
            
            # Job name typically contains meetingId as part of it
            # For now, let's extract meetingId from the job name (might need adjustment based on actual format)
            meeting_id = job_name  # Assuming job_name is the meetingId for now
            
            logger.info(f"Extracted meetingId: {meeting_id} from S3 URI: {s3_uri}")
            return meeting_id
            
    except Exception as e:
        logger.error(f"Failed to extract meeting info from S3 URI {s3_uri}: {e}")
        return None


def get_user_sns_topic_for_meeting(meeting_id):
    """Get user's SNS topic ARN for a specific meeting from the database."""
    try:
        # First, get meeting info to find the userId
        meetings_table = os.environ.get("MEETINGS_TABLE_NAME")
        if not meetings_table:
            raise ValueError("MEETINGS_TABLE_NAME environment variable is required")
            
        # Query meeting by meetingId
        meeting_response = dynamodb_client.query(
            TableName=meetings_table,
            KeyConditionExpression="meetingId = :meetingId",
            ExpressionAttributeValues={
                ":meetingId": {"S": meeting_id}
            },
            Limit=1
        )
        
        if not meeting_response.get("Items"):
            logger.error(f"Meeting {meeting_id} not found in database")
            return None
            
        meeting = meeting_response["Items"][0]
        user_id = meeting.get("userId", {}).get("S")
        user_email = meeting.get("userEmail", {}).get("S")
        
        if not user_email:
            logger.error(f"No userEmail found for meeting {meeting_id}")
            return None
            
        # Extract username from email for user preferences lookup
        # UserPreferences table uses username as userId, not Cognito user ID
        username = user_email.split('@')[0] if user_email else None
        if not username:
            logger.error(f"Could not extract username from email: {user_email}")
            return None
            
        # Get user's SNS topic from user preferences table
        user_preferences_table = os.environ.get("USER_PREFERENCES_TABLE_NAME")
        if not user_preferences_table:
            raise ValueError("USER_PREFERENCES_TABLE_NAME environment variable is required")
            
        logger.info(f"Looking up user preferences in table: {user_preferences_table}")
        logger.info(f"Searching for username: {username} (extracted from email: {user_email})")
        logger.info(f"Original Cognito userId was: {user_id}")
        
        user_response = dynamodb_client.get_item(
            TableName=user_preferences_table,
            Key={
                "userId": {"S": username}
            }
        )
        
        logger.info(f"DynamoDB response: {user_response}")
        
        if not user_response.get("Item"):
            logger.error(f"User preferences not found for username {username}")
            logger.error(f"Table: {user_preferences_table}")
            logger.error(f"Searched username: {username} (from email: {user_email})")
            logger.error(f"Original Cognito userId: {user_id}")
            return None
            
        user_prefs = user_response["Item"]
        sns_topic_arn = user_prefs.get("snsTopicArn", {}).get("S")
        email_notifications_enabled = user_prefs.get("emailNotificationsEnabled", {}).get("BOOL", True)
        
        logger.info(f"Found SNS topic: {sns_topic_arn}")
        logger.info(f"Email notifications enabled: {email_notifications_enabled}")
        
        if not email_notifications_enabled:
            logger.info(f"Email notifications disabled for username {username}")
            return None
            
        if not sns_topic_arn:
            logger.error(f"No SNS topic ARN found for username {username}")
            return None
            
        logger.info(f"Found SNS topic {sns_topic_arn} for username {username} (meeting {meeting_id})")
        return {
            "sns_topic_arn": sns_topic_arn,
            "user_id": user_id,  # Keep original Cognito user ID for reference
            "username": username,  # Add username for clarity
            "user_email": user_email
        }
        
    except Exception as e:
        logger.error(f"Failed to get user SNS topic for meeting {meeting_id}: {e}")
        return None


def generate_presigned_url(s3_uri):
    """Generate a presigned URL for S3 object access."""
    try:
        parsed_uri = urlparse(s3_uri)
        bucket_name = parsed_uri.netloc
        object_key = parsed_uri.path.lstrip('/')

        logger.info(f"Generating presigned URL for s3://{bucket_name}/{object_key}")

        # Generate presigned URL
        presigned_url = s3_client.generate_presigned_url(
            "get_object",
            Params={"Bucket": bucket_name, "Key": object_key},
            ExpiresIn=PRESIGNED_URL_EXPIRATION,
        )

        logger.info("Presigned URL generated successfully")
        return presigned_url

    except Exception as e:
        logger.error(f"Failed to generate presigned URL for {s3_uri}: {e}")
        raise


def send_notification_to_user_topic(sns_topic_arn, subject, message):
    """Send notification to user's dedicated SNS topic."""
    try:
        logger.info(f"Sending notification to SNS topic: {sns_topic_arn}")
        
        response = sns_client.publish(
            TopicArn=sns_topic_arn,
            Subject=subject,
            Message=message
        )
        
        message_id = response.get("MessageId")
        logger.info(f"Notification sent successfully. MessageId: {message_id}")
        return message_id
        
    except Exception as e:
        logger.error(f"Failed to send notification to {sns_topic_arn}: {e}")
        raise


def create_email_content(html_url, pdf_url, original_filename, user_email):
    """Create email content with download links."""
    subject = "Your Semantic Lighthouse meeting transcript is ready"
    
    # Create email body
    message_lines = [
        f"Hello,",
        f"",
        f"Your meeting transcript for '{original_filename}' has been processed successfully.",
        f"",
        f"You can download your meeting minutes in the following formats:",
        f"",
    ]
    
    if html_url:
        message_lines.extend([
            f"📄 Interactive HTML Version (with video links):",
            f"{html_url}",
            f"",
        ])
    
    if pdf_url:
        message_lines.extend([
            f"📑 PDF Version (for printing):",
            f"{pdf_url}",
            f"",
        ])
    
    message_lines.extend([
        f"⚠️  Note: These download links will expire in 7 days for security.",
        f"",
        f"The interactive HTML version includes clickable timestamps that will take you directly to the relevant portions of your meeting video.",
        f"",
        f"Thank you for using Semantic Lighthouse!",
        f"",
        f"---",
        f"This notification was sent to: {user_email}",
        f"If you no longer wish to receive these notifications, you can update your preferences in your account settings.",
    ])
    
    return subject, "\n".join(message_lines)


def lambda_handler(event, context):
    """
    Lambda function handler for sending email notifications using per-user SNS topics.

    Expected input from Step Functions:
    {
        "htmlS3Uri": "s3://bucket/path/to/transcript.html",
        "pdfS3Uri": "s3://bucket/path/to/transcript.pdf",
        "originalFileName": "meeting-video.mp4"
    }
    """
    logger.info("=== EmailSender Lambda Started ===")
    logger.info(f"Received event: {json.dumps(event, indent=2)}")

    try:
        # Extract inputs from event
        html_s3_uri = event.get("htmlS3Uri")
        pdf_s3_uri = event.get("pdfS3Uri")
        original_filename = event.get("originalFileName", "meeting-video")

        # Gracefully ignore unexpected triggers (e.g., raw S3 events without payload)
        if not html_s3_uri and not pdf_s3_uri:
            logger.warning(
                "Event missing htmlS3Uri/pdfS3Uri – likely non-workflow trigger. Ignoring."
            )
            return {
                "statusCode": 200,
                "success": False,
                "message": "Ignored event without html/pdf URI",
            }

        logger.info(f"Processing HTML: {html_s3_uri}")
        logger.info(f"Processing PDF: {pdf_s3_uri}")
        logger.info(f"Original filename: {original_filename}")

        # =================================================================
        # EXTRACT MEETING ID AND GET USER'S SNS TOPIC FROM DATABASE
        # =================================================================
        
        # Extract meetingId from originalFileName 
        # Format: uploads/meeting_recordings/{meetingId}.mp4
        meeting_id = None
        if original_filename:
            # Extract filename from path and remove extension
            filename = original_filename.split('/')[-1]  # Get the filename part
            meeting_id = filename.split('.')[0]  # Remove extension
            logger.info(f"Extracted meetingId: {meeting_id} from original filename: {original_filename}")
            
        if not meeting_id:
            logger.error("Could not extract meetingId from original filename")
            raise ValueError("Unable to determine meeting ID from original filename")
            
        # Get user's SNS topic information
        user_info = get_user_sns_topic_for_meeting(meeting_id)
        if not user_info:
            logger.error(f"Could not find user SNS topic for meeting {meeting_id}")
            raise ValueError(f"Unable to find notification settings for meeting {meeting_id}")
            
        sns_topic_arn = user_info["sns_topic_arn"]
        user_email = user_info["user_email"]
        user_id = user_info["user_id"]
        
        logger.info(f"Sending notification to user {user_id} ({user_email}) via topic {sns_topic_arn}")

        # =================================================================
        # GENERATE PRESIGNED URLS FOR DOWNLOAD LINKS
        # =================================================================
        
        html_download_url = None
        pdf_download_url = None

        if html_s3_uri:
            html_download_url = generate_presigned_url(html_s3_uri)
            logger.info("HTML presigned URL generated successfully")

        if pdf_s3_uri:
            pdf_download_url = generate_presigned_url(pdf_s3_uri)
            logger.info("PDF presigned URL generated successfully")

        # =================================================================
        # CREATE AND SEND EMAIL NOTIFICATION
        # =================================================================
        
        # Create email content
        subject, message = create_email_content(
            html_download_url, pdf_download_url, original_filename, user_email
        )

        # Send notification to user's SNS topic
        message_id = send_notification_to_user_topic(sns_topic_arn, subject, message)

        logger.info("=== EmailSender Lambda Completed Successfully ===")
        return {
            "statusCode": 200,
            "success": True,
            "message": f"Notification sent successfully to user {user_id}",
            "messageId": message_id,
            "meetingId": meeting_id,
            "userEmail": user_email,
        }

    except Exception as e:
        logger.error("=== EmailSender Lambda FAILED ===")
        logger.error(f"Error: {str(e)}")
        logger.error(f"Full traceback:", exc_info=True)
        
        return {
            "statusCode": 500,
            "success": False,
            "error": str(e),
            "message": "Failed to send notification",
        }
