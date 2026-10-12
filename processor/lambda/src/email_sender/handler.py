import json
import boto3
import logging
import os
from datetime import datetime, timezone
from urllib.parse import urlparse

# Set up logging
logger = logging.getLogger()
logger.setLevel(logging.INFO)

# Initialize AWS clients
s3_client = boto3.client("s3")
sns_client = boto3.client("sns")
dynamodb_client = boto3.client("dynamodb")

# Configuration
# The email links to this page; it fetches fresh download links after sign-in.
# (Links signed here died within hours: they only live as long as this Lambda's credentials.)
FRONTEND_DOMAIN_NAME = os.environ.get("FRONTEND_DOMAIN_NAME")


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
        
        if not user_id:
            logger.error(f"No userId found for meeting {meeting_id}")
            return None
            
        if not user_email:
            logger.error(f"No userEmail found for meeting {meeting_id}")
            return None
            
        # Get user's SNS topic from user preferences table
        # UserPreferences table uses the actual Cognito username as userId
        user_preferences_table = os.environ.get("USER_PREFERENCES_TABLE_NAME")
        if not user_preferences_table:
            raise ValueError("USER_PREFERENCES_TABLE_NAME environment variable is required")
            
        logger.info(f"Looking up user preferences in table: {user_preferences_table}")
        logger.info(f"Searching for userId: {user_id}")
        logger.info(f"User email: {user_email}")
        
        user_response = dynamodb_client.get_item(
            TableName=user_preferences_table,
            Key={
                "userId": {"S": user_id}
            }
        )
        
        logger.info(f"DynamoDB response: {user_response}")
        
        if not user_response.get("Item"):
            logger.error(f"User preferences not found for userId {user_id}")
            logger.error(f"Table: {user_preferences_table}")
            logger.error(f"Searched userId: {user_id}")
            logger.error(f"User email: {user_email}")
            return None
            
        user_prefs = user_response["Item"]
        sns_topic_arn = user_prefs.get("snsTopicArn", {}).get("S")
        email_notifications_enabled = user_prefs.get("emailNotificationsEnabled", {}).get("BOOL", True)
        
        logger.info(f"Found SNS topic: {sns_topic_arn}")
        logger.info(f"Email notifications enabled: {email_notifications_enabled}")
        
        if not email_notifications_enabled:
            logger.info(f"Email notifications disabled for userId {user_id}")
            return None
            
        if not sns_topic_arn:
            logger.error(f"No SNS topic ARN found for userId {user_id}")
            return None
            
        logger.info(f"Found SNS topic {sns_topic_arn} for userId {user_id} (meeting {meeting_id})")
        return {
            "sns_topic_arn": sns_topic_arn,
            "user_id": user_id,
            "user_email": user_email
        }
        
    except Exception as e:
        logger.error(f"Failed to get user SNS topic for meeting {meeting_id}: {e}")
        return None


def record_minutes_on_meeting(meeting_id, html_s3_uri, pdf_s3_uri):
    """Store where the minutes are on the meeting record and mark it complete.

    The minutes page reads these keys to hand out fresh download links.
    Returns the meeting title for the email.
    """
    meetings_table = os.environ["MEETINGS_TABLE_NAME"]
    meeting = dynamodb_client.query(
        TableName=meetings_table,
        KeyConditionExpression="meetingId = :meetingId",
        ExpressionAttributeValues={":meetingId": {"S": meeting_id}},
        Limit=1,
    )["Items"][0]
    dynamodb_client.update_item(
        TableName=meetings_table,
        Key={"meetingId": meeting["meetingId"], "createdAt": meeting["createdAt"]},
        UpdateExpression="SET #status = :status, htmlS3Key = :html, pdfS3Key = :pdf, updatedAt = :now",
        ExpressionAttributeNames={"#status": "status"},
        ExpressionAttributeValues={
            ":status": {"S": "processing-complete"},
            ":html": {"S": urlparse(html_s3_uri).path.lstrip("/")},
            ":pdf": {"S": urlparse(pdf_s3_uri).path.lstrip("/")},
            ":now": {"S": datetime.now(timezone.utc).isoformat()},
        },
    )
    logger.info(f"Recorded minutes on meeting {meeting_id}: {html_s3_uri}, {pdf_s3_uri}")
    return meeting.get("meetingTitle", {}).get("S", "your meeting")


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


def create_email_content(minutes_url, meeting_title, user_email):
    """Create the email: one link to the minutes page, which works for as long as the account does."""
    # SNS email subjects must be under 100 characters and on one line
    subject = " ".join(f"Minutes ready: {meeting_title}".split())[:99]
    message = "\n".join([
        "Hello,",
        "",
        f"The minutes for \"{meeting_title}\" are ready.",
        "",
        "View and download them here (sign in with your Minute Maker account):",
        minutes_url,
        "",
        "The page has the PDF, ready to send, and an interactive version that links each item to that moment in the video.",
        "",
        "Thank you for using Minute Maker!",
        "",
        "---",
        f"This notification was sent to: {user_email}",
        "If you no longer wish to receive these notifications, you can update your preferences in your account settings.",
    ])
    return subject, message


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
        # RECORD THE MINUTES ON THE MEETING AND EMAIL A LINK TO THE MINUTES PAGE
        # =================================================================

        if not html_s3_uri or not pdf_s3_uri:
            raise ValueError("Both htmlS3Uri and pdfS3Uri are required to record the minutes")
        if not FRONTEND_DOMAIN_NAME:
            raise ValueError("FRONTEND_DOMAIN_NAME environment variable is required")

        meeting_title = record_minutes_on_meeting(meeting_id, html_s3_uri, pdf_s3_uri)
        minutes_url = f"https://{FRONTEND_DOMAIN_NAME}/minutes?id={meeting_id}"

        subject, message = create_email_content(minutes_url, meeting_title, user_email)

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
