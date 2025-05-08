import boto3
import json

def read_agenda(file_path):
    """Read the agenda file and return its contents as a string."""
    try:
        with open(file_path, 'r') as file:
            return file.read()
    except Exception as e:
        print(f"Error reading agenda file: {e}")
        return "No agenda available."

def read_transcript(file_path):
    """Read the sequential transcript JSON file and return its contents."""
    try:
        with open(file_path, 'r') as file:
            return json.load(file)
    except Exception as e:
        print(f"Error reading transcript file: {e}")
        return []

def format_transcript_for_prompt(transcript):
    """Format the transcript in a way that's suitable for the prompt."""
    formatted_transcript = []
    for segment in transcript:
        formatted_transcript.append(
            f"[{segment['id']}] {segment['speaker']}: {segment['text']}\n"
        )
    return "".join(formatted_transcript)

def analyze_transcript(transcript, agenda):
    """
    Use Claude to analyze the transcript for votes, topic transitions,
    and connections to agenda items.
    """
    # Initialize the Bedrock Runtime client
    bedrock_runtime = boto3.client(
        service_name='bedrock-runtime',
        region_name='us-west-2'
    )

    # Format the transcript for the prompt
    formatted_transcript = format_transcript_for_prompt(transcript)

    # Prepare the prompt
    prompt = f"""Go through this transcript for a board meeting. The context of the board meeting should be clear from the agenda and the transcript.
I want you to go through this and look for the segments where there is a vote taking place or where there is a topic transition.
Refer to the agenda for more info:

AGENDA:
{agenda}

TRANSCRIPT:
{formatted_transcript}

I want you to reference specific segments for topic transitions, segments where a vote takes place, which segments refer to which agenda item, etc. Please also mention what each agenda item is about and what the vote was about. Also include what discussions were had about each agenda item and other information. Be very thorough in the discussion of each agenda item and the vote. Be sure to include what things were discussed, debated etc in detail.
Please be EXTREMELY comprehensive and specific in your analysis, always referencing segment IDs when discussing parts of the transcript. For the references i want you to use the format [seg_0] or [seg_0-55] if using a range of segments.
"""
    # prompt = "What is the capital of Colombia?, please answer in detail and include the history of the capital and its significance.\n\n"
    with open("prompt.txt", "w") as f:
        f.write(prompt)
    # Create the request payload for Claude
    request_body = {
        "anthropic_version": "bedrock-2023-05-31",
        "max_tokens": 8000,  # Increased for comprehensive analysis
        "temperature": 0.2,  # Lower temperature for more focused analysis
        "messages": [
            {
                "role": "user",
                "content": prompt
            }
        ]
    }

    # Replace the current invoke_model call in the analyze_transcript function with this streaming implementation
    try:
        # Make the streaming API call
        print("Invoking Claude with streaming...")
        response = bedrock_runtime.invoke_model_with_response_stream(
            modelId='us.anthropic.claude-3-7-sonnet-20250219-v1:0',
            contentType='application/json',
            accept='application/json',
            body=json.dumps(request_body)
        )

        # Process the streaming response
        analysis_chunks = []
        print("\nStreaming response:")
        print("-" * 80)

        # Iterate through the streaming chunks
        for event in response.get('body'):
            # Process each chunk
            if 'chunk' in event:
                chunk_data = json.loads(event['chunk']['bytes'])
                if chunk_data.get('type') == 'content_block_delta' and chunk_data.get('delta', {}).get('text'):
                    text_chunk = chunk_data['delta']['text']
                    print(text_chunk, end='', flush=True)
                    analysis_chunks.append(text_chunk)

        print("\n" + "-" * 80)

        # Combine all chunks to return the complete analysis
        analysis = ''.join(analysis_chunks)
        return analysis

    except Exception as e:
        print(f"Error invoking Claude: {e}")
        return f"Error analyzing transcript: {e}"

def save_analysis(analysis, output_file="transcript_analysis.txt"):
    """Save the analysis to a file."""
    try:
        with open(output_file, 'w') as file:
            file.write(analysis)
        print(f"Analysis saved to {output_file}")
    except Exception as e:
        print(f"Error saving analysis: {e}")

def main():
    # File paths
    agenda_file = "agenda.txt"
    transcript_file = "sequential_transcript.json"

    # Read the files
    agenda = read_agenda(agenda_file)
    transcript = read_transcript(transcript_file)

    if not transcript:
        print("Failed to load transcript. Exiting.")
        return

    print("Analyzing transcript...")

    # Analyze the transcript
    analysis = analyze_transcript(transcript, agenda)

    # Print the analysis
    print("\nANALYSIS RESULTS:")
    print("-" * 80)
    print(analysis)
    print("-" * 80)

    # Save the analysis to a file
    save_analysis(analysis)

    print("\nAnalysis complete!")

if __name__ == "__main__":
    main()
