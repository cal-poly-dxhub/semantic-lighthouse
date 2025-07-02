import os
import logging
import boto3
import tempfile
from urllib.parse import urlparse

# WeasyPrint will be provided by the external Lambda layer
from weasyprint import HTML  # type: ignore

logger = logging.getLogger()
logger.setLevel(logging.INFO)

s3_client = boto3.client("s3")


def fetch_html_from_s3(s3_uri: str) -> str:
    """Download HTML file content from S3 and return as string."""
    parsed = urlparse(s3_uri)
    if parsed.scheme != "s3":
        raise ValueError(f"Expected S3 URI, got: {s3_uri}")

    bucket = parsed.netloc
    key = parsed.path.lstrip("/")

    logger.info(f"Downloading HTML from s3://{bucket}/{key}")
    response = s3_client.get_object(Bucket=bucket, Key=key)
    content = response["Body"].read().decode("utf-8")
    logger.info(f"Downloaded {len(content)} characters of HTML")
    return content


def upload_pdf_to_s3(pdf_bytes: bytes, bucket: str, key: str) -> str:
    logger.info(f"Uploading PDF to s3://{bucket}/{key} ({len(pdf_bytes)} bytes)")
    s3_client.put_object(
        Bucket=bucket,
        Key=key,
        Body=pdf_bytes,
        ContentType="application/pdf",
    )
    return f"s3://{bucket}/{key}"


def convert_html_to_pdf(html_content: str) -> bytes:
    """Convert HTML string to PDF bytes using WeasyPrint."""
    with tempfile.NamedTemporaryFile(suffix=".html", delete=False) as tmp_html:
        tmp_html.write(html_content.encode("utf-8"))
        tmp_html.flush()
        logger.info(f"Temporary HTML file created at {tmp_html.name}")

        pdf_bytes = HTML(filename=tmp_html.name).write_pdf()
    logger.info(f"Generated PDF with {len(pdf_bytes)} bytes")
    return pdf_bytes


def lambda_handler(event, context):
    """Entry point for Lambda invocation from Step Functions.

    Expected payload:
    {
        "htmlS3Uri": "s3://bucket/analysis/job_analysis.html",
        "outputFileName": "meeting-video.mp4" // optional, for naming
    }
    """
    logger.info("=== HtmlToPdfConverter Lambda Started ===")
    logger.info(f"Received event: {event}")

    html_s3_uri = event.get("htmlS3Uri")
    if not html_s3_uri:
        raise ValueError("htmlS3Uri is required")

    # Use same bucket/prefix as HTML, change extension to .pdf
    parsed = urlparse(html_s3_uri)
    bucket = parsed.netloc
    html_key = parsed.path.lstrip("/")

    job_root = os.path.splitext(os.path.basename(html_key))[0].replace("_analysis", "")
    output_pdf_key = f"analysis/{job_root}_analysis.pdf"

    # 1. Download HTML
    html_content = fetch_html_from_s3(html_s3_uri)

    # 2. Convert to PDF
    pdf_bytes = convert_html_to_pdf(html_content)

    # 3. Upload PDF
    pdf_s3_uri = upload_pdf_to_s3(pdf_bytes, bucket, output_pdf_key)

    logger.info("=== HtmlToPdfConverter Lambda Completed Successfully ===")

    return {
        "statusCode": 200,
        "success": True,
        "pdfS3Uri": pdf_s3_uri,
        "bytes": len(pdf_bytes),
    }
