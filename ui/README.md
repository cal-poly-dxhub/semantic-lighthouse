# Semantic Lighthouse

A comprehensive solution for automatically processing videos of board meetings into searchable, analyzable transcripts with AI-powered summaries and linkable PDFs.

<!-- TODO: ONE CLICK DEPLOY BUTTON -->

## Overview

Semantic Lighthouse automates the entire process of:

1. Downloading audio from board meeting videos
2. Transcribing the audio with AWS Transcribe (with speaker identification)
3. Converting the transcript to human-readable formats
4. Segmenting and matching discussions to agenda items
5. Generating structured analysis and summaries of the meeting content
6. Creating a professional PDF with clickable timestamps back to the original video

## Features

<!-- TODO: webapp stuff -->

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

<!-- TODO: hopefully none, if any it should be an aws account and an internet connection lol -->

## Installation

1. Clone this repository:

```bash
git clone https://github.com/yourusername/semantic-lighthouse.git
cd semantic-lighthouse
```

### Example

```bash
# TODO
echo TODO
```

## Pipeline Steps

## Architecture

<!-- TODO: make an arch diagram -->

![Architecture Diagram](docs/ArchDiagram.png)

<!-- TODO: describe arch diagram -->

## Contributing

- Contributions are welcome! Please make a pull request to propose changes.
- For more information, reach out to <schidraw@amazon.com> or <gflusser@amazon.com>

## Acknowledgments

This project utilizes several open-source libraries and AWS services including:

- AWS Transcribe for speech-to-text
- AWS Bedrock for Claude AI integration
<!-- TODO more aws stuff here -->
