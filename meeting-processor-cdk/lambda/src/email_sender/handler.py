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

# Configuration
EMAIL_FILE_S3_URI = (
    "https://k12-temp-testing-static-files.s3.us-west-2.amazonaws.com/email.txt"
)
PRESIGNED_URL_EXPIRATION = 86400  # 24 hours


def get_email_from_s3():
    """Read email address from the S3 text file."""
    try:
        bucket = "k12-temp-testing-static-files"
        key = "email.txt"

        logger.info(f"Reading email from s3://{bucket}/{key}")
        response = s3_client.get_object(Bucket=bucket, Key=key)
        email = response["Body"].read().decode("utf-8").strip()

        logger.info(f"Found email: {email}")
        return email

    except Exception as e:
        logger.error(f"Failed to read email from S3: {e}")
        raise


def generate_presigned_url(s3_uri, expiration=PRESIGNED_URL_EXPIRATION):
    """Generate a presigned URL for the PDF download."""
    try:
        parsed = urlparse(s3_uri)
        if parsed.scheme != "s3":
            raise ValueError(f"Invalid S3 URI scheme: {parsed.scheme}")

        bucket = parsed.netloc
        key = parsed.path.lstrip("/")

        logger.info(f"Generating presigned URL for s3://{bucket}/{key}")

        presigned_url = s3_client.generate_presigned_url(
            "get_object", Params={"Bucket": bucket, "Key": key}, ExpiresIn=expiration
        )

        logger.info("Presigned URL generated successfully")
        return presigned_url

    except Exception as e:
        logger.error(f"Failed to generate presigned URL: {e}")
        raise


def is_email_subscribed(email, topic_arn):
    """Check if email is already subscribed to the SNS topic."""
    try:
        logger.info(f"Checking if {email} is subscribed to topic")

        paginator = sns_client.get_paginator("list_subscriptions_by_topic")
        for page in paginator.paginate(TopicArn=topic_arn):
            for subscription in page["Subscriptions"]:
                if (
                    subscription["Protocol"] == "email"
                    and subscription["Endpoint"] == email
                    and subscription["SubscriptionArn"] != "PendingConfirmation"
                ):
                    logger.info(f"Email {email} is already subscribed")
                    return True

        logger.info(f"Email {email} is not subscribed")
        return False

    except Exception as e:
        logger.error(f"Error checking subscription status: {e}")
        return False


def subscribe_email_to_topic(email, topic_arn):
    """Subscribe email to SNS topic."""
    try:
        logger.info(f"Subscribing {email} to topic {topic_arn}")

        response = sns_client.subscribe(
            TopicArn=topic_arn, Protocol="email", Endpoint=email
        )

        subscription_arn = response["SubscriptionArn"]
        logger.info(f"Subscription initiated. ARN: {subscription_arn}")
        return subscription_arn

    except Exception as e:
        logger.error(f"Failed to subscribe email: {e}")
        raise


def send_notification(
    email, topic_arn, html_download_url, pdf_download_url, original_filename
):
    """Send email notification via SNS."""
    try:
        # Ensure email is subscribed
        if not is_email_subscribed(email, topic_arn):
            logger.info(f"Email {email} not subscribed, subscribing now...")
            subscribe_email_to_topic(email, topic_arn)
            logger.info(
                "Email subscribed! User will need to confirm subscription before receiving notifications."
            )

        # Prepare message content
        subject = "Your meeting transcript is ready"

        # Build download options based on available files
        download_options = []

        if html_download_url:
            download_options.append(
                f"""📄 HTML Version (Recommended): {html_download_url}
   - Interactive web page with clickable segment links
   - Best for viewing on computers and mobile devices
   - Links open directly in your browser"""
            )

        if pdf_download_url:
            download_options.append(
                f"""📋 PDF Version: {pdf_download_url}
   - Printable document format
   - Compatible with all PDF readers
   - Good for offline viewing and sharing"""
            )

        download_section = "\n\n".join(download_options)
        format_intro = (
            "Choose your preferred format:"
            if len(download_options) > 1
            else "Download your transcript:"
        )

        message = f"""Hey User!

Your meeting transcript is ready: {original_filename}

{format_intro}

{download_section}

(All download links expire in 24 hours)

If this is your first notification, you may have received a subscription confirmation email from AWS SNS. Please confirm your subscription to receive future notifications automatically.

Best regards,
Semantic Lighthouse"""

        # Send notification
        logger.info(f"Sending notification to topic {topic_arn}")
        response = sns_client.publish(
            TopicArn=topic_arn, Message=message, Subject=subject
        )

        message_id = response["MessageId"]
        logger.info(f"Notification sent successfully. Message ID: {message_id}")

        return {
            "success": True,
            "messageId": message_id,
            "recipient": email,
            "subscriptionStatus": (
                "confirmed"
                if is_email_subscribed(email, topic_arn)
                else "pending_confirmation"
            ),
        }

    except Exception as e:
        logger.error(f"Failed to send notification: {e}")
        raise


def lambda_handler(event, context):
    """
    Lambda function handler for sending email notifications.

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
        # Get configuration from environment
        topic_arn = os.environ.get("SNS_TOPIC_ARN")
        if not topic_arn:
            raise ValueError("SNS_TOPIC_ARN environment variable is required")

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

        # Get email address from S3
        email = get_email_from_s3()

        # Generate presigned URLs for available files
        html_download_url = None
        pdf_download_url = None

        if html_s3_uri:
            html_download_url = generate_presigned_url(html_s3_uri)
            logger.info("HTML presigned URL generated successfully")

        if pdf_s3_uri:
            pdf_download_url = generate_presigned_url(pdf_s3_uri)
            logger.info("PDF presigned URL generated successfully")

        # Send notification
        result = send_notification(
            email, topic_arn, html_download_url, pdf_download_url, original_filename
        )

        logger.info("=== EmailSender Lambda Completed Successfully ===")

        return {
            "statusCode": 200,
            "success": True,
            "notification": result,
            "htmlDownloadUrl": html_download_url,
            "pdfDownloadUrl": pdf_download_url,
            "recipient": email,
        }

    except Exception as e:
        logger.error("=== EmailSender Lambda FAILED ===")
        logger.error(f"Error type: {type(e).__name__}")
        logger.error(f"Error message: {str(e)}")
        logger.error(f"Full traceback:", exc_info=True)

        return {"statusCode": 500, "success": False, "error": str(e)}
