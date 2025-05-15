# Semantic Lighthouse

A comprehensive solution for automatically processing YouTube videos of board meetings into searchable, analyzable transcripts with AI-powered summaries and linkable PDFs.

## Overview

Semantic Lighthouse automates the entire process of:

1. Downloading audio from YouTube board meeting videos
2. Transcribing the audio with AWS Transcribe (with speaker identification)
3. Converting the transcript to human-readable formats
4. Segmenting and matching discussions to agenda items
5. Generating structured analysis and summaries of the meeting content
6. Creating a professional PDF with clickable timestamps back to the original video

## Features

- **Full automation** - Process videos with a single command
- **Speaker identification** - AWS Transcribe identifies different speakers
- **Agenda integration** - Match discussions to specific agenda items
- **Topic segmentation** - Automatically identify topic transitions in meetings
- **Two summary modes**:
  - **Detailed** - Comprehensive analysis of discussions, votes, and agenda items
  - **Sparse** - Concise action minutes focusing only on decisions and votes
- **Interactive PDF output** - Clickable timestamps link directly to video moments
- **Segment references** - Easy navigation between transcript and video
- **Audio processing utilities** - Split audio files and remove silence

## Requirements

- Python 3.11+
- AWS account with Transcribe, S3, and Bedrock access
- Required Python packages (see Installation)
- For macOS users: Homebrew for library dependencies

## Installation

1. Clone this repository:

   ```
   git clone https://github.com/yourusername/semantic-lighthouse.git
   cd semantic-lighthouse
   ```

2. Install required Python packages:

   ```
   pip install -r requirements.txt
   ```

3. Configure AWS credentials:

   ```
   aws configure
   ```

4. For macOS users, install WeasyPrint dependencies:
   ```
   brew install cairo pango
   ```

## Usage

### Basic Usage

```
python src/pipeline.py <youtube_url> <agenda_path> [summary_type]
```

### Parameters

- `youtube_url`: URL of the YouTube video to process
- `agenda_path`: Path to a text file containing the meeting agenda
- `summary_type`: Optional - either "detailed" (default) or "sparse"

### Example

```
python src/pipeline.py "https://www.youtube.com/watch?v=QgrSLH-1WIw" "src/lynwoodmay8agenda.txt" detailed
```

## Pipeline Steps

1. **Setup and Initialization** - Configures AWS clients and output directories
2. **YouTube Audio Download** - Downloads the audio from the specified video
3. **S3 Upload** - Uploads the audio to AWS S3
4. **Transcription** - Starts an AWS Transcribe job with speaker identification
5. **Transcript Processing** - Converts raw AWS output to human-readable formats
6. **Topic Segmentation** - Identifies discussion topics and matches to agenda items
7. **Summary Generation** - Analyzes transcript against agenda using Claude AI
8. **PDF Creation** - Produces a professional PDF with clickable timestamps

## Output Files

The pipeline generates the following files in the `output` directory:

- `audio.mp3` - Extracted audio from the YouTube video
- `transcript.json` - Raw AWS Transcribe output
- `human_readable.txt` - Formatted transcript with speaker labels
- `sequential_transcript.json` - Structured JSON of the transcript
- `summary.txt` - AI-generated analysis of the meeting
- `output.pdf` - Professional PDF with clickable timestamps
- `transcript_analysis_with_links.pdf` - Alternative PDF format
- `transcript_lookup.json` - Index for quick segment reference

## Architecture

The project includes an architecture diagram in the `docs` directory. View `docs/ArchDiagram.png` for a visual representation of the pipeline workflow.

## Cleanup

To remove temporary files after processing:

```
./src/analysis/cleanup.sh
```

## Contributing

- Contributions are welcome! Please make a pull request to propose changes.
- For more information, reach out to schidraw@calpoly.edu.

## Acknowledgments

This project utilizes several open-source libraries and AWS services including:

- AWS Transcribe for speech-to-text
- AWS Bedrock for Claude AI integration
- yt-dlp for YouTube video downloads
- WeasyPrint for PDF generation
