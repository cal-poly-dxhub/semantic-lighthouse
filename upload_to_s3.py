import logging
import boto3
from botocore.exceptions import ClientError
import os


def upload_file(file_name, bucket, object_name=None):
    """Upload a file to an S3 bucket

    :param file_name: File to upload
    :param bucket: Bucket to upload to
    :param object_name: S3 object name. If not specified then file_name is used
    :return: True if file was uploaded, else False
    """

    if object_name is None:
        object_name = os.path.basename(file_name)

    s3_client = boto3.client('s3')
    try:
        response = s3_client.upload_file(file_name, bucket, object_name)
    except ClientError as e:
        logging.error(e)
        return False
    return True

if __name__ == "__main__":
    file_name = 'board-meeting-march13.mp3'
    bucket_name = 'k12-video-data'
    object_name = 'board-meeting-march13.mp3'

    if upload_file(file_name, bucket_name, object_name):
        print(f"File {file_name} uploaded to {bucket_name}/{object_name}")
    else:
        print(f"Failed to upload {file_name} to {bucket_name}/{object_name}")
