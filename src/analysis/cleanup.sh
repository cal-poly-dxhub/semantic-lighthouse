#!/bin/bash

# Remove transcript-related files
rm -f readable_transcript.txt transcript_analysis.txt transcript_lookup.json
rm -f transcribe_output.json nicer_transcript_analysis_with_links.pdf prompt.txt sequential_transcript.json

# Remove additional files
rm -f agenda.txt

echo "All specified files have been removed."
