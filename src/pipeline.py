import os
import sys
import boto3
import requests
import yt_dlp
from pathlib import Path
import json
import time
from typing import Optional
import logging
import platform
import subprocess
from colorama import init, Fore, Style

# Initialize colorama
init()

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

def setup_macos_libraries():
    """Setup Homebrew library paths for macOS"""
    print(f"\n{Fore.CYAN}[Step 1] Setting up macOS libraries...{Style.RESET_ALL}")
    if platform.system() == "Darwin":
        try:
            prefix = subprocess.check_output(["brew", "--prefix"], text=True).strip()
            libdir = os.path.join(prefix, "lib")
            os.environ["DYLD_LIBRARY_PATH"] = f"{libdir}:{os.environ.get('DYLD_LIBRARY_PATH','')}"
            print(f"{Fore.GREEN}✓ macOS libraries setup completed{Style.RESET_ALL}")
            return True
        except Exception as e:
            print(f"{Fore.YELLOW}⚠ Warning: Could not setup Homebrew libraries: {e}{Style.RESET_ALL}")
            logger.warning(f"Could not setup Homebrew libraries: {e}")
            return False
    return True

class TranscriptionPipeline:
    def __init__(self, youtube_url: str, agenda_path: str, output_dir: str = "output"):
        print(f"\n{Fore.CYAN}[Initialization] Starting pipeline setup...{Style.RESET_ALL}")
        self.youtube_url = youtube_url
        self.agenda_path = agenda_path
        self.output_dir = Path(output_dir)
        self.output_dir.mkdir(exist_ok=True)
        print(f"{Fore.GREEN}✓ Output directory created/verified at: {self.output_dir}{Style.RESET_ALL}")
        
        # Initialize AWS clients with region
        print(f"{Fore.CYAN}[Initialization] Setting up AWS clients...{Style.RESET_ALL}")
        self.s3_client = boto3.client('s3', region_name='us-west-2')
        self.transcribe_client = boto3.client('transcribe', region_name='us-west-2')
        print(f"{Fore.GREEN}✓ AWS clients initialized{Style.RESET_ALL}")
        
        # Configuration
        self.bucket_name = "k12-video-data"  # Replace with your bucket name
        self.audio_file = self.output_dir / "audio.mp3"
        self.transcript_file = self.output_dir / "transcript.json"
        self.human_readable_file = self.output_dir / "human_readable.txt"
        self.summary_file = self.output_dir / "summary.txt"
        self.sequential_json = self.output_dir / "sequential_transcript.json"
        self.pdf_file = self.output_dir / "output.pdf"
        print(f"{Fore.GREEN}✓ Pipeline configuration completed{Style.RESET_ALL}")

    def download_youtube_audio(self):
        """Download audio from YouTube URL"""
        print(f"\n{Fore.CYAN}[Step 2] Starting YouTube audio download...{Style.RESET_ALL}")
        print(f"{Fore.WHITE}URL: {self.youtube_url}{Style.RESET_ALL}")
        ydl_opts = {
            'format': 'bestaudio/best',
            'postprocessors': [{
                'key': 'FFmpegExtractAudio',
                'preferredcodec': 'mp3',
                'preferredquality': '192',
            }],
            'outtmpl': str(self.audio_file.with_suffix('')),
        }
        
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            ydl.download([self.youtube_url])
        
        print(f"{Fore.GREEN}✓ Audio downloaded successfully to: {self.audio_file}{Style.RESET_ALL}")

    def upload_to_s3(self):
        """Upload audio file to S3"""
        print(f"\n{Fore.CYAN}[Step 3] Uploading audio to S3...{Style.RESET_ALL}")
        s3_key = f"audio/{self.audio_file.name}"
        print(f"{Fore.WHITE}Uploading to bucket: {self.bucket_name}{Style.RESET_ALL}")
        print(f"{Fore.WHITE}File key: {s3_key}{Style.RESET_ALL}")
        self.s3_client.upload_file(str(self.audio_file), self.bucket_name, s3_key)
        print(f"{Fore.GREEN}✓ Audio upload completed{Style.RESET_ALL}")
        return f"s3://{self.bucket_name}/{s3_key}"

    def start_transcription_job(self, s3_uri: str):
        """Start AWS Transcribe job with speaker partitioning"""
        print(f"\n{Fore.CYAN}[Step 4] Starting AWS transcription job...{Style.RESET_ALL}")
        job_name = f"transcription-{int(time.time())}"
        print(f"{Fore.WHITE}Job name: {job_name}{Style.RESET_ALL}")
        print(f"{Fore.WHITE}Configuring transcription settings...{Style.RESET_ALL}")
        
        response = self.transcribe_client.start_transcription_job(
            TranscriptionJobName=job_name,
            Media={'MediaFileUri': s3_uri},
            MediaFormat='mp3',
            LanguageCode='en-US',
            Settings={
                'ShowSpeakerLabels': True,
                'MaxSpeakerLabels': 30,
                'ShowAlternatives': True,
                'MaxAlternatives': 3,
            }
        )
        
        print(f"{Fore.GREEN}✓ Transcription job started successfully{Style.RESET_ALL}")
        return job_name

    def wait_for_transcription(self, job_name: str):
        """Wait for transcription job to complete"""
        print(f"\n{Fore.CYAN}[Step 5] Waiting for transcription to complete...{Style.RESET_ALL}")
        print(f"{Fore.WHITE}Monitoring job: {job_name}{Style.RESET_ALL}")
        while True:
            response = self.transcribe_client.get_transcription_job(
                TranscriptionJobName=job_name
            )
            status = response['TranscriptionJob']['TranscriptionJobStatus']
            print(f"{Fore.WHITE}Current status: {status}{Style.RESET_ALL}")
            
            if status in ['COMPLETED', 'FAILED']:
                break
                
            time.sleep(30)
        
        if status == 'FAILED':
            print(f"{Fore.RED}❌ Transcription job failed{Style.RESET_ALL}")
            raise Exception("Transcription job failed")
        
        print(f"{Fore.GREEN}✓ Transcription completed successfully{Style.RESET_ALL}")
        print(f"{Fore.WHITE}Downloading transcript...{Style.RESET_ALL}")
        transcript_uri = response['TranscriptionJob']['Transcript']['TranscriptFileUri']
        transcript_data = json.loads(requests.get(transcript_uri).text)
        
        with open(self.transcript_file, 'w') as f:
            json.dump(transcript_data, f)
        
        print(f"{Fore.GREEN}✓ Transcript saved to: {self.transcript_file}{Style.RESET_ALL}")

    def generate_human_readable(self):
        """Convert transcript to human readable format"""
        print(f"\n{Fore.CYAN}[Step 6] Converting transcript to human readable format...{Style.RESET_ALL}")
        from analysis.human_readable import convert_to_human_readable
        convert_to_human_readable(str(self.transcript_file), str(self.human_readable_file), str(self.sequential_json))
        print(f"{Fore.GREEN}✓ Human readable transcript saved to: {self.human_readable_file}{Style.RESET_ALL}")
        print(f"{Fore.GREEN}✓ Sequential JSON saved to: {self.sequential_json}{Style.RESET_ALL}")

    def generate_summary(self):
        """Generate summary of the transcript"""
        print(f"\n{Fore.CYAN}[Step 7] Generating transcript summary...{Style.RESET_ALL}")
        from analysis.generate_summary import generate_summary
        generate_summary(str(self.human_readable_file), str(self.summary_file))
        print(f"{Fore.GREEN}✓ Summary saved to: {self.summary_file}{Style.RESET_ALL}")

    def create_pdf(self):
        """Create PDF with transcript and summary"""
        print(f"\n{Fore.CYAN}[Step 8] Creating final PDF document...{Style.RESET_ALL}")
        print(f"{Fore.WHITE}Setting up required libraries...{Style.RESET_ALL}")
        setup_macos_libraries()
        from analysis.make_pdf import create_pdf
        create_pdf(
            str(self.summary_file),
            str(self.sequential_json),
            str(self.pdf_file),
            self.youtube_url
        )
        print(f"{Fore.GREEN}✓ PDF document created successfully at: {self.pdf_file}{Style.RESET_ALL}")

    def run(self):
        """Run the complete pipeline"""
        print(f"\n{Fore.MAGENTA}=== Starting Transcription Pipeline ==={Style.RESET_ALL}")
        try:
            self.download_youtube_audio()
            s3_uri = self.upload_to_s3()
            job_name = self.start_transcription_job(s3_uri)
            self.wait_for_transcription(job_name)
            self.generate_human_readable()
            self.generate_summary()
            self.create_pdf()
            print(f"\n{Fore.MAGENTA}=== Pipeline completed successfully! ==={Style.RESET_ALL}")
        except Exception as e:
            print(f"\n{Fore.RED}❌ Pipeline failed: {str(e)}{Style.RESET_ALL}")
            logger.error(f"Pipeline failed: {str(e)}")
            raise

def main():
    if len(sys.argv) != 3:
        print(f"{Fore.RED}Usage: python pipeline.py <youtube_url> <agenda_path>{Style.RESET_ALL}")
        sys.exit(1)
    
    youtube_url = sys.argv[1]
    agenda_path = sys.argv[2]
    
    print(f"\n{Fore.MAGENTA}=== Transcription Pipeline ==={Style.RESET_ALL}")
    print(f"{Fore.WHITE}YouTube URL: {youtube_url}{Style.RESET_ALL}")
    print(f"{Fore.WHITE}Agenda Path: {agenda_path}{Style.RESET_ALL}")
    
    pipeline = TranscriptionPipeline(youtube_url, agenda_path)
    pipeline.run()

if __name__ == "__main__":
    main() 