import json
def main():
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

if __name__ == "__main__":
    main()