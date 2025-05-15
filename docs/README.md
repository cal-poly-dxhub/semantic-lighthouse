# Board Meeting Transcription Pipeline

A comprehensive solution for automatically processing YouTube videos of board meetings into searchable, analyzable transcripts with summaries and linkable PDFs.

## Overview

This pipeline automates the entire process of:
1. Downloading audio from YouTube board meeting videos
2. Transcribing the audio with AWS Transcribe (with speaker identification)
3. Converting the transcript to human-readable formats
4. Generating structured analysis of the meeting content
5. Creating a professional PDF with linkable timestamps back to the original video

## Features

- **Full automation** - Process videos with a single command
- **Speaker identification** - AWS Transcribe identifies different speakers
- **Agenda integration** - Incorporate meeting agendas into analysis
- **Two summary modes**:
  - **Detailed** - Comprehensive analysis of discussions, votes, and agenda items
  - **Sparse** - Concise action minutes focusing only on decisions and votes
- **Interactive PDF output** - Clickable timestamps link directly to video moments
- **Segment references** - Easy navigation between transcript and video

## Requirements

- Python 3.8+
- AWS account with Transcribe and S3 access
- Required Python packages (see Installation)
- For macOS users: Homebrew for library dependencies

## Installation

1. Clone this repository:
   ```
   git clone <repository-url>
   cd board-meeting-transcription
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
python pipeline.py <youtube_url> <agenda_path> [summary_type]
```

### Parameters

- `youtube_url`: URL of the YouTube video to process
- `agenda_path`: Path to a text file containing the meeting agenda
- `summary_type`: Optional - either "detailed" (default) or "sparse"

### Example

```
python pipeline.py "https://www.youtube.com/watch?v=QgrSLH-1WIw" "agenda.txt" detailed
```

## Pipeline Steps

1. **Setup and Initialization** - Configures AWS clients and output directories
2. **YouTube Audio Download** - Downloads the audio from the specified video
3. **S3 Upload** - Uploads the audio to AWS S3
4. **Transcription** - Starts an AWS Transcribe job with speaker identification
5. **Transcript Processing** - Converts raw AWS output to human-readable formats
6. **Summary Generation** - Analyzes transcript against agenda using AI
7. **PDF Creation** - Produces a professional PDF with clickable timestamps

## Output Files

The pipeline generates the following files in the `output` directory:

- `audio.mp3` - Extracted audio from the YouTube video
- `transcript.json` - Raw AWS Transcribe output
- `human_readable.txt` - Formatted transcript with speaker labels
- `sequential_transcript.json` - Structured JSON of the transcript
- `summary.txt` - AI-generated analysis of the meeting
- `output.pdf` - Professional PDF with clickable timestamps

## Cleanup

To remove temporary files after processing:

```
./cleanup.sh
```

## Configuration

The pipeline is configured to use AWS services in the `us-west-2` region. To modify this or other settings, edit the appropriate constants in `pipeline.py`.

## Project Structure

- `pipeline.py` - Main entry point and pipeline orchestration
- `analysis/` - Directory containing analysis and processing modules:
  - `human_readable.py` - Converts AWS Transcribe output to readable formats
  - `generate_summary.py` - Produces AI-driven meeting analysis
  - `make_pdf.py` - Creates the final PDF document
- `prompts/` - Contains templates for different summary types:
  - `detailed_prompt.txt` - Template for comprehensive analysis
  - `sparse_prompt.txt` - Template for action minutes
- `cleanup.sh` - Utility script to remove temporary files

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

[Include your license information here]

## Acknowledgments

This project utilizes several open-source libraries and AWS services.
