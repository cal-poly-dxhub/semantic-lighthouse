# Email Notification Setup Guide

This guide explains how to set up and test the new email notification feature that sends PDF transcripts via SNS.

## What's New

The system now automatically sends email notifications with PDF download links when transcript processing is complete. The email notification uses AWS SNS and reads the recipient email from an S3 file.

## Architecture

```
Video Upload → MediaConvert → Transcribe → ProcessTranscript → EmailSender → SNS → User Email
```

## Setup Steps

### 1. Prepare Email Configuration

Create or update the email configuration file:

```
s3://k12-temp-testing-static-files/email.txt
```

The file should contain a single email address:

```
your-email@example.com
```

### 2. Deploy the Updated Stack

Deploy the meeting processor with the new email functionality:

```bash
cd meeting-processor
sam build
sam deploy
```

The deployment will create:

- ✅ New `EmailSenderLambda` function
- ✅ New SNS topic for notifications
- ✅ Updated Step Functions workflow
- ✅ Required IAM permissions

### 3. First Time Email Subscription

**Important**: The first time an email receives a notification, the user will need to confirm their SNS subscription.

**User Experience:**

1. **Upload video** → Processing starts
2. **User receives two emails**:
   - **First email**: "AWS Notification - Subscription Confirmation"
   - **User clicks**: "Confirm subscription" link
   - **Second email**: "Your meeting transcript is ready" with PDF download link

**For subsequent videos**: Only the transcript notification email is sent.

## Testing the System

### 1. Quick Test Setup

1. **Set email.txt**:

   ```bash
   # Put your email in the configuration file
   echo "your-email@example.com" | aws s3 cp - s3://k12-temp-testing-static-files/email.txt
   ```

2. **Upload test video**:

   ```bash
   # Upload any MP4 video to trigger the workflow
   aws s3 cp test-video.mp4 s3://YOUR-BUCKET-NAME/uploads/
   ```

3. **Check your email**:
   - Look for AWS SNS confirmation email
   - Click "Confirm subscription"
   - Look for transcript notification with download link

### 2. Monitor the Process

**Check Step Functions execution**:

```bash
# Get the state machine ARN from stack outputs
aws cloudformation describe-stacks --stack-name YOUR-STACK-NAME --query 'Stacks[0].Outputs'

# Monitor executions in AWS Console
# Go to Step Functions → Your state machine → Executions
```

**Check Lambda logs**:

```bash
# EmailSender Lambda logs
aws logs tail /aws/lambda/EMAIL-SENDER-FUNCTION-NAME

# ProcessTranscript Lambda logs
aws logs tail /aws/lambda/PROCESS-TRANSCRIPT-FUNCTION-NAME
```

## Email Content Example

The notification email will look like:

```
Subject: Your meeting transcript is ready

Hey User!

Your meeting transcript is ready: test-video.mp4

Download your PDF here: https://s3.amazonaws.com/bucket/path/to/file.pdf?AWSAccessKeyId=...
(Link expires in 24 hours)

If this is your first notification, you may have received a subscription confirmation email from AWS SNS. Please confirm your subscription to receive future notifications automatically.

Best regards,
Semantic Lighthouse
```

## Configuration Details

### Environment Variables (Auto-configured)

- `SNS_TOPIC_ARN`: Set automatically by SAM template
- `S3_BUCKET`: Meeting files bucket name

### Permissions (Auto-configured)

- ✅ S3 read access to `k12-temp-testing-static-files`
- ✅ S3 read access to meeting files bucket
- ✅ SNS publish/subscribe permissions
- ✅ Step Functions invoke permissions

### File Locations

- **Email config**: `s3://k12-temp-testing-static-files/email.txt`
- **Generated PDF**: `s3://your-bucket/transcripts/{job-name}.pdf`
- **Download link**: 24-hour presigned URL

## Troubleshooting

### Email Not Received

1. **Check email.txt file exists and contains valid email**
2. **Check spam folder** for AWS SNS confirmation
3. **Verify SNS subscription status** in AWS Console
4. **Check EmailSender Lambda logs** for errors

### PDF Download Link Not Working

1. **Link expires after 24 hours** - Check timestamp
2. **Check PDF was actually generated** in S3 bucket
3. **Verify S3 permissions** for presigned URL generation

### Step Functions Execution Fails

1. **Check ProcessTranscript Lambda** returns `pdfS3Uri` field
2. **Verify EmailSender Lambda** has proper SNS permissions
3. **Check all environment variables** are set correctly

## Advanced Configuration

### Multiple Email Recipients

To support multiple emails, modify `email_sender/handler.py`:

- Read multiple emails from `email.txt` (one per line)
- Loop through emails in `send_notification()` function

### Custom Email Templates

To customize email content, modify the `message` variable in `send_notification()` function.

### Email Delivery Monitoring

- Enable SNS delivery status logging
- Set up CloudWatch alarms for failed deliveries
- Monitor bounce/complaint rates

## Stack Outputs

After deployment, check these outputs:

```bash
aws cloudformation describe-stacks --stack-name YOUR-STACK-NAME --query 'Stacks[0].Outputs'
```

Key outputs:

- `EmailNotificationTopicArn`: SNS topic for notifications
- `EmailSenderLambdaArn`: Email sending function
- `StateMachineArn`: Updated workflow with email step

## Next Steps

1. **Test with a short video** first (< 5 minutes)
2. **Confirm email subscription** works properly
3. **Test with longer video** to verify chunked processing
4. **Monitor costs** for SNS email delivery
5. **Consider HTML email templates** for future enhancement

The email notification system is now fully integrated into your existing video processing workflow! 🎉
