#!/bin/bash

FILES=(
  readable_transcript.txt
  transcript_analysis.txt
  transcript_lookup.json
  transcribe_output.json
  nicer_transcript_analysis_with_links.pdf
  prompt.txt
  sequential_transcript.json
  agenda.txt
)

REMOVED=0
NOT_FOUND=0

for FILE in "${FILES[@]}"; do
  if [ -e "$FILE" ]; then
    rm -f "$FILE"
    echo "Removed: $FILE"
    ((REMOVED++))
  else
    echo "Not found: $FILE"
    ((NOT_FOUND++))
  fi
done

echo "Cleanup complete."
echo "Files removed: $REMOVED"
echo "Files not found: $NOT_FOUND"
