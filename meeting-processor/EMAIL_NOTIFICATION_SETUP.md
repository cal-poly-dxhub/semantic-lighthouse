# Email Notification Setup Guide

This guide explains how to set up and test the new email notification feature that sends PDF transcripts via SNS.

## What's New

The system now includes three major enhancements:

1. **Email Notifications**: Automatically sends email notifications with file download links when transcript processing is complete. Uses AWS SNS and reads the recipient email from an S3 file.

2. **Dual Format Output**: Each transcript analysis is now generated in both HTML and PDF formats:

   - **HTML Version**: Interactive web page with native clickable hyperlinks - ideal for online viewing
   - **PDF Version**: Printable document format - perfect for offline use and sharing

3. **Video Hyperlinks**: Segment citations in the analysis (like `[seg_0]` or `[seg_1-3]`) are automatically converted to clickable hyperlinks that jump to the exact timestamp in the original video. Each link includes a presigned URL to the video with timestamp fragments like `#t=00:01:23`.

## Architecture

```
Video Upload → MediaConvert → Transcribe → ProcessTranscript → [Add Video Links + Generate HTML & PDF] → EmailSender → SNS → User Email with HTML & PDF Links
```

### Video Hyperlinks Feature

The system now automatically converts segment citations in the Bedrock analysis to clickable video links:

- **Input**: `"The meeting started in [seg_0] with roll call"`
- **Output**: `"The meeting started in [seg_0] with roll call"` (where `[seg_0]` is now clickable)

The segment citations remain visually clean but become clickable hyperlinks that open the video at the exact timestamp.

**Supported Citation Formats:**

- Single segments: `[seg_0]`, `[seg_5]`
- Range format 1: `[seg_1-2]` (segments 1 through 2)
- Range format 2: `[seg_5-seg_6]` (segments 5 through 6)

**Video URL Format:**

- Uses presigned S3 URLs with timestamp fragments: `https://s3.../video.mp4?AWS...#t=00:01:23`
- Links expire in 24 hours (same as PDF download)
- Timestamps link to the exact moment in the original uploaded video

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
4. **Test both formats and video hyperlinks**:
   - **HTML Version**: Click the HTML link in the email
     - Opens as a web page with clean, styled content
     - Segment citations like `[seg_0]` are clickable blue links
     - Click a segment link to open video at exact timestamp
   - **PDF Version**: Download the PDF from the email link
     - Opens as a printable document
     - Segment citations are clickable (depending on PDF viewer)
     - Works offline and can be shared easily

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

Choose your preferred format:

📄 HTML Version (Recommended): https://s3.amazonaws.com/bucket/path/to/file.html?AWSAccessKeyId=...
   - Interactive web page with clickable segment links
   - Best for viewing on computers and mobile devices
   - Links open directly in your browser

📋 PDF Version: https://s3.amazonaws.com/bucket/path/to/file.pdf?AWSAccessKeyId=...
   - Printable document format
   - Compatible with all PDF readers
   - Good for offline viewing and sharing

(All download links expire in 24 hours)

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
- **Generated HTML**: `s3://your-bucket/analysis/{job-name}_analysis.html`
- **Generated PDF**: `s3://your-bucket/analysis/{job-name}_analysis.pdf`
- **Download links**: 24-hour presigned URLs for both formats

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

### Video Hyperlinks Not Working

1. **Check segment mapping** in ProcessTranscript Lambda logs
2. **Verify originalVideoInfo** is passed correctly from Step Functions
3. **Check presigned URL generation** doesn't fail due to permissions
4. **Verify video file exists** in the original S3 location
5. **Test manually** by copying a generated video URL and checking if it loads

### Video Links Don't Jump to Correct Time

1. **Check timestamp format** in human-readable transcript
2. **Verify #t= format** is correctly appended to URLs
3. **Test with different video players** (browser compatibility)
4. **Check video file duration** vs. timestamp references

### Links Still Show Full URLs

If you still see full URLs in the PDF instead of clean clickable text:

1. **Check ProcessTranscript Lambda logs** for "VIDEOLINK" markers in output
2. **Verify PDF generation** is processing the special markers correctly
3. **Redeploy the stack** to ensure the latest code is running:
   ```bash
   sam build && sam deploy
   ```
4. **Test with a new video** to ensure changes take effect

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

## Example Output

### Before (Plain Text Citations)

```
Meeting Opening and Initial Procedures
Call to Order and Roll Call
The meeting was called to order at 5:31 PM as indicated in [seg_0].
Superintendent Dr. Gudiel R. Crosthwaite conducted the roll call in [seg_1-2].
```

### After (Clickable Video Links)

```
Meeting Opening and Initial Procedures
Call to Order and Roll Call
The meeting was called to order at 5:31 PM as indicated in [seg_0].
Superintendent Dr. Gudiel R. Crosthwaite conducted the roll call in [seg_1-2].
```

**Note**: The text looks identical, but now `[seg_0]` and `[seg_1-2]` are clickable hyperlinks!

When users click these links in the PDF:

- Browser opens the video URL with timestamp (e.g., `#t=00:05:31`)
- Video player seeks to the exact timestamp
- User can watch the specific moment being referenced
- PDF remains clean without visible URLs

## Log Examples

### Successful Processing

```
[INFO] Built segment mapping with 156 segments
[INFO] Adding video links for s3://bucket/uploads/meeting-video.mp4
[INFO] Found 23 segment references in text
[INFO] Replaced [seg_0] with video link at 00:05:31
[INFO] Replaced [seg_1-2] with video link at 00:05:45
[INFO] Successfully processed 23 segment references
[INFO] Video hyperlinks added successfully
```

**Note**: The segment citations now appear as clean, clickable text in the PDF without showing the underlying video URLs. The system uses special markers during processing that are converted to proper ReportLab hyperlinks in the final PDF.

The email notification system with interactive video hyperlinks is now fully integrated into your existing video processing workflow! 🎉
