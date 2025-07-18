# Semantic-Lighthouse: Automated Board Meeting Minutes Generator

## Table of Contents

- [Collaboration](#collaboration)
- [Disclaimers](#disclaimers)
- [Overview](#overview)
- [Architecture](#architecture)
- [Deployment Steps](#deployment-steps)
- [Troubleshooting](#troubleshooting)
- [Known Limitations](#known-limitations)
- [Support](#support)

# Collaboration

Thanks for your interest in our solution. Having specific examples of replication and usage allows us to continue to grow and scale our work. If you clone or use this repository, kindly shoot us a quick email to let us know you are interested in this work!

<wwps-cic@amazon.com>

# Disclaimers

**Customers are responsible for making their own independent assessment of the information in this document.**

**This document:**

(a) is for informational purposes only,

(b) represents current AWS product offerings and practices, which are subject to change without notice, and

(c) does not create any commitments or assurances from AWS and its affiliates, suppliers or licensors. AWS products or services are provided “as is” without warranties, representations, or conditions of any kind, whether express or implied. The responsibilities and liabilities of AWS to its customers are controlled by AWS agreements, and this document is not part of, nor does it modify, any agreement between AWS and its customers.

(d) is not to be considered a recommendation or viewpoint of AWS

**Additionally, all prototype code and associated assets should be considered:**

(a) as-is and without warranties

(b) not suitable for production environments

(d) to include shortcuts in order to support rapid prototyping such as, but not limitted to, relaxed authentication and authorization and a lack of strict adherence to security best practices

**All work produced is open source. More information can be found in the GitHub repo.**

## Authors

- Swayam Chidrawar - <schidra@amazon.com>
- Gus Flusser - <gflusser@amazon.com>

## Overview

Semantic-Lighthouse is an automated solution that transforms board meeting videos and agenda documents into comprehensive meeting minutes. The system processes video recordings alongside agenda documents to generate structured PDF minutes with direct links back to the relevant video segments.

#### Key Features

- Automated meeting minutes generation from video recordings
- PDF output with video segment linking
- Agenda-aware content structuring
- User management system with admin capabilities
- Serverless architecture for scalability

#### Technical Specifications

- Supported Input Formats:
  - Video: MP4
  - Agenda: PDF
- Output Format: PDF with embedded video links
- Processing Time: Approximately 10 minutes per hour of video
- AWS-native solution deployed via CDK

## Architecture

### Architecture Diagram

![arch-diagram](semantic-lighthouse-v1-light.drawio.svg)

The solution consists of several key components:

1. Frontend Interface

   - NextJS client application
   - Amazon CloudFront distribution
   - S3 static asset bucket

2. API Layer

   - Amazon API Gateway
   - AWS Lambda functions
   - Amazon Cognito authorizer

3. Meeting Processor

   - Multi-stage processing pipeline
   - Amazon MediaConvert for audio extraction
   - Amazon Bedrock for AI processing
   - Amazon Transcribe for speech-to-text
   - Amazon Textract for agenda document ingestion

4. Data Storage and Logs

   - Amazon DynamoDB for meeting data
   - Amazon CloudWatch for monitoring
   - S3 buckets for meeting artifacts

Additionally other AWS services are used for additional functionality

## Deployment Steps

### Prerequisites

- AWS Account with appropriate permissions
- CDK cli [see here](https://docs.aws.amazon.com/cdk/v2/guide/cli.html)

### 1. CDK Deployment

1. Bootstrap your AWS account:

```bash
cd ui
cdk bootstrap
cd ..
```

2. Deploy the stack

```bash
cd ui
cdk deploy
cd ..
```

### 2. Initial Setup

After deployment:

1. Access the provided application URL (if you get an AccessDenied screen, just wait a few minues for the webiste build to complete)
2. Create the initial admin user (first user to sign up)
3. Additional users can be created through the admin interface

### 3. Using the System

1. Upload meeting video (MP4) and agenda (PDF)
2. System will automatically begin processing
3. Progress can be monitored in the dashboard
4. Download generated minutes when processing completes

## Troubleshooting

Common issues and solutions:

- Video Upload Failures

  - Check file format (video must be MP4)

- Processing Delays

  - Normal processing takes ~10 minutes per hour of video
  - Check CloudWatch logs for specific errors
  - Verify service quotas if processing multiple videos

- Authentication Issues
  - Remember only first signup is allowed
  - Additional users must be created by admin
  - Check Cognito user pool status

## Known Limitations

- Currently supports only MP4 video format
- Single admin user model (other users are unable to create more users)
- Processing time scales with video length

## Support

For any queries or issues, please contact:

- Swayam Chidrawar, Jr. SDE - <schidra@amazon.com>
- Gus Flusser, Jr. SDE - <gflusser@amazon.com>
