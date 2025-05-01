from __future__ import print_function
import time
import boto3
import uuid

transcribe = boto3.client('transcribe', 'us-west-2')
job_name = f"my-second-transcription-job-k12-{str(uuid.uuid4())}"
job_uri = "https://k12-video-data.s3.us-west-2.amazonaws.com/board-meeting-march13.mp3"
transcribe.start_transcription_job(
    TranscriptionJobName = job_name,
    Media = {
        'MediaFileUri': job_uri
    },
    OutputBucketName = 'k12-video-data',
    OutputKey = 'my-output-files/',
    LanguageCode = 'en-US',
    Settings = {
        'ShowSpeakerLabels': True,
        'MaxSpeakerLabels': 3
    }
)

while True:
    status = transcribe.get_transcription_job(TranscriptionJobName = job_name)
    if status['TranscriptionJob']['TranscriptionJobStatus'] in ['COMPLETED', 'FAILED']:
        break
    print("Not ready yet...")
    time.sleep(5)
print(status)
