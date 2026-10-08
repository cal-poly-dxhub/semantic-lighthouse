"""
Shared utility functions for Lambda functions.
This module contains common functionality to reduce code duplication.
"""

import boto3
import logging
import os
from urllib.parse import urlparse


def setup_logger(name: str = None) -> logging.Logger:
    """
    Standard logging setup for all Lambda functions.

    Args:
        name: Logger name (optional)

    Returns:
        Configured logger instance
    """
    logger = logging.getLogger(name)
    logger.setLevel(logging.INFO)
    return logger


def parse_s3_uri(s3_uri: str) -> tuple[str, str]:
    """
    Parse S3 URI into bucket and key components.

    Args:
        s3_uri: S3 URI in format s3://bucket/key

    Returns:
        Tuple of (bucket, key)

    Raises:
        ValueError: If URI is not a valid S3 URI
    """
    parsed = urlparse(s3_uri)
    if parsed.scheme != "s3":
        raise ValueError(f"Invalid S3 URI scheme: {parsed.scheme}")

    bucket = parsed.netloc
    key = parsed.path.lstrip("/")
    return bucket, key


def generate_presigned_url(s3_uri: str, expiration: int = 86400) -> str:
    """
    Generate a presigned URL for S3 object access.

    Args:
        s3_uri: S3 URI in format s3://bucket/key
        expiration: URL expiration time in seconds (default: 24 hours)

    Returns:
        Presigned URL string

    Raises:
        ValueError: If URI is invalid
        Exception: If URL generation fails
    """
    s3_client = boto3.client("s3")
    bucket, key = parse_s3_uri(s3_uri)

    return s3_client.generate_presigned_url(
        "get_object", Params={"Bucket": bucket, "Key": key}, ExpiresIn=expiration
    )


def check_s3_object_exists(bucket: str, key: str) -> bool:
    """
    Check if an S3 object exists.

    Args:
        bucket: S3 bucket name
        key: S3 object key

    Returns:
        True if object exists, False otherwise
    """
    s3_client = boto3.client("s3")
    try:
        s3_client.head_object(Bucket=bucket, Key=key)
        return True
    except s3_client.exceptions.NoSuchKey:
        return False
    except Exception:
        return False


def extract_filename_without_extension(s3_key: str) -> str:
    """
    Extract filename without extension from S3 key.

    Args:
        s3_key: S3 object key

    Returns:
        Filename without extension

    Example:
        "uploads/meeting_recordings/board_meeting_2024_01_15.mp4" -> "board_meeting_2024_01_15"
    """
    filename = s3_key.split("/")[-1]  # Get filename
    return os.path.splitext(filename)[0]  # Remove extension


def get_s3_text_content(bucket: str, key: str) -> str:
    """
    Fetch text content from S3 object.

    Args:
        bucket: S3 bucket name
        key: S3 object key

    Returns:
        Text content as string

    Raises:
        Exception: If fetch fails
    """
    s3_client = boto3.client("s3")
    response = s3_client.get_object(Bucket=bucket, Key=key)
    return response["Body"].read().decode("utf-8")
