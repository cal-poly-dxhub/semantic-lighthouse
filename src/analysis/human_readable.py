import json

def process_transcribe_output(file_path):
    with open(file_path, 'r') as file:
        transcribe_data = json.load(file)

    # Check if the results contain the expected format
    if ('results' not in transcribe_data or
        'speaker_labels' not in transcribe_data['results'] or
        'items' not in transcribe_data['results']):
        print("Error: Unexpected format in the transcript file.")
        return None

    # Use audio_segments if available
    if 'audio_segments' in transcribe_data['results']:
        # Sort segments by start_time to maintain chronological order
        segments = sorted(
            transcribe_data['results']['audio_segments'],
            key=lambda x: float(x['start_time'])
        )

        # Create a list of sequential utterances with speaker labels and IDs
        sequential_transcript = []
        for idx, segment in enumerate(segments):
            speaker = segment['speaker_label']
            text = segment['transcript']
            # Create a unique segment ID in the format "seg_{index}"
            segment_id = f"seg_{idx}"
            sequential_transcript.append({
                "id": segment_id,
                "speaker": speaker,
                "text": text,
                "start_time": float(segment['start_time']),
                "end_time": float(segment['end_time'])
            })

        return sequential_transcript

    # If audio_segments doesn't exist, we'll need to build the segments ourselves
    else:
        # Get speaker segments with timing information
        speaker_segments = []
        for segment in transcribe_data['results']['speaker_labels']['segments']:
            speaker_segments.append({
                'speaker_label': segment['speaker_label'],
                'start_time': float(segment['start_time']),
                'end_time': float(segment['end_time']),
                'items': [item['start_time'] for item in segment['items']]
            })

        # Sort segments by start_time
        speaker_segments = sorted(speaker_segments, key=lambda x: x['start_time'])

        # Get all items with their content
        items_dict = {}
        for item in transcribe_data['results']['items']:
            if 'id' in item and 'alternatives' in item and len(item['alternatives']) > 0:
                # For pronunciation items, include start_time
                if item['type'] == 'pronunciation':
                    items_dict[int(item['id'])] = {
                        'content': item['alternatives'][0]['content'],
                        'type': item['type'],
                        'start_time': float(item.get('start_time', '0')),
                        'end_time': float(item.get('end_time', '0')),
                        'speaker_label': item.get('speaker_label', None)
                    }
                else:
                    # For punctuation items, just include content
                    items_dict[int(item['id'])] = {
                        'content': item['alternatives'][0]['content'],
                        'type': item['type']
                    }

        # Build the sequential transcript segment by segment
        sequential_transcript = []

        for idx, segment in enumerate(speaker_segments):
            speaker = segment['speaker_label']
            segment_start = segment['start_time']
            segment_end = segment['end_time']

            # Find all items that belong to this segment
            segment_items = []
            for item_id, item in items_dict.items():
                if item['type'] == 'pronunciation' and \
                   segment_start <= item['start_time'] < segment_end:
                    segment_items.append((item_id, item))

            # Sort items by start_time
            segment_items.sort(key=lambda x: x[1]['start_time'])

            # Build the text for this segment
            segment_text = []
            for item_id, item in segment_items:
                if segment_text and item['type'] != 'punctuation':
                    segment_text.append(" ")
                segment_text.append(item['content'])

                # Add any punctuation that follows this item
                if item_id + 1 in items_dict and items_dict[item_id + 1]['type'] == 'punctuation':
                    segment_text.append(items_dict[item_id + 1]['content'])

            # Add the segment to the transcript if it has content
            if segment_items:
                # Create a unique segment ID in the format "seg_{index}"
                segment_id = f"seg_{idx}"
                sequential_transcript.append({
                    "id": segment_id,
                    "speaker": speaker,
                    "text": "".join(segment_text),
                    "start_time": segment_start,
                    "end_time": segment_end
                })

        return sequential_transcript

def format_for_reading(sequential_transcript):
    # Create a text version for easy reading (for the LLM)
    readable_text = []
    for entry in sequential_transcript:
        readable_text.append(f"[{entry['id']}] {entry['speaker']}: {entry['text']}")

    # Create a lookup map for easy referencing
    lookup_map = {entry['id']: entry for entry in sequential_transcript}

    # Return both formats
    return {
        "text": "\n".join(readable_text),
        "structured": sequential_transcript,
        "lookup": lookup_map
    }

def main():
    input_file = "transcribe_output.json"

    # Process the transcription
    sequential_transcript = process_transcribe_output(input_file)

    if sequential_transcript:
        # Format for easy reading
        formatted_output = format_for_reading(sequential_transcript)

        # Save the structured JSON
        json_output_file = "sequential_transcript.json"
        with open(json_output_file, 'w') as file:
            json.dump(sequential_transcript, file, indent=2)

        # Save the human-readable text version
        text_output_file = "readable_transcript.txt"
        with open(text_output_file, 'w') as file:
            file.write(formatted_output["text"])

        # Save the lookup dictionary for easy segment reference
        lookup_file = "transcript_lookup.json"
        with open(lookup_file, 'w') as file:
            json.dump(formatted_output["lookup"], file, indent=2)

        print(f"Sequential transcript saved to {json_output_file}")
        print(f"Human-readable transcript saved to {text_output_file}")
        print(f"Lookup dictionary saved to {lookup_file}")

        # Print a sample of the output
        print("\nSample Output (Human-Readable):")
        print(formatted_output["text"][:500] + "..." if len(formatted_output["text"]) > 500 else formatted_output["text"])

        print("\nHow to reference segments in Python:")
        print("""
# Example of how to reference transcript segments in Python:
import json

# Load the transcript
with open('sequential_transcript.json', 'r') as file:
    transcript = json.load(file)

# Reference by index
first_segment = transcript[0]
print(f"First segment: {first_segment['speaker']}: {first_segment['text']}")

# Reference by ID using the lookup dictionary
with open('transcript_lookup.json', 'r') as file:
    lookup = json.load(file)

# Get a specific segment by ID
segment = lookup['seg_1']  # Replace 'seg_1' with any segment ID
print(f"Segment {segment['id']}: {segment['speaker']}: {segment['text']}")
""")

if __name__ == "__main__":
    main()
