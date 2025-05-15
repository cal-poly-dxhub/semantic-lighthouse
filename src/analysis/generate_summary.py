import boto3
import json
from colorama import init, Fore, Style

# Initialize colorama
init()

def read_agenda(file_path):
    """Read the agenda file and return its contents as a string."""
    try:
        with open(file_path, 'r') as file:
            return file.read()
    except Exception as e:
        print(f"{Fore.RED}❌ Error reading agenda file: {e}{Style.RESET_ALL}")
        return "No agenda available."

def read_transcript(file_path):
    """Read the transcript file and return its contents."""
    try:
        with open(file_path, 'r') as file:
            content = file.read()
            # Try to parse as JSON first
            try:
                return json.loads(content)
            except json.JSONDecodeError:
                # If not JSON, return as text
                return content
    except Exception as e:
        print(f"{Fore.RED}❌ Error reading transcript file: {e}{Style.RESET_ALL}")
        return None

def format_transcript_for_prompt(transcript):
    """Format the transcript in a way that's suitable for the prompt."""
    # If transcript is a string (text file), return it as is
    if isinstance(transcript, str):
        return transcript
        
    # If transcript is a list (JSON), format it
    formatted_transcript = []
    for segment in transcript:
        formatted_transcript.append(
            f"[{segment['id']}] {segment['speaker']}: {segment['text']}\n"
        )
    return "".join(formatted_transcript)

def analyze_transcript(transcript, agenda):
    """
    Use Claude to analyze the transcript using the prompt from prompt.txt.
    """
    print(f"\n{Fore.CYAN}[Step 1] Initializing AWS Bedrock client...{Style.RESET_ALL}")
    # Initialize the Bedrock Runtime client
    bedrock_runtime = boto3.client(
        service_name='bedrock-runtime',
        region_name='us-west-2'
    )
    print(f"{Fore.GREEN}✓ AWS Bedrock client initialized{Style.RESET_ALL}")

    # Read the formatted prompt from prompt.txt
    print(f"\n{Fore.CYAN}[Step 2] Reading prompt template...{Style.RESET_ALL}")
    try:
        with open("prompt.txt", "r") as f:
            prompt = f.read()
        print(f"{Fore.GREEN}✓ Prompt template loaded successfully{Style.RESET_ALL}")
    except Exception as e:
        print(f"{Fore.RED}❌ Error reading prompt file: {e}{Style.RESET_ALL}")
        return f"Error: Could not read prompt file: {e}"

    # Create the request payload for Claude
    print(f"\n{Fore.CYAN}[Step 3] Preparing Claude request...{Style.RESET_ALL}")
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
    print(f"{Fore.GREEN}✓ Request payload prepared{Style.RESET_ALL}")

    try:
        # Make the streaming API call
        print(f"\n{Fore.CYAN}[Step 4] Invoking Claude with streaming...{Style.RESET_ALL}")
        response = bedrock_runtime.invoke_model_with_response_stream(
            modelId='us.anthropic.claude-3-7-sonnet-20250219-v1:0',
            contentType='application/json',
            accept='application/json',
            body=json.dumps(request_body)
        )

        # Process the streaming response
        analysis_chunks = []
        print(f"\n{Fore.MAGENTA}=== Claude's Response ==={Style.RESET_ALL}")

        # Iterate through the streaming chunks
        for event in response.get('body'):
            # Process each chunk
            if 'chunk' in event:
                chunk_data = json.loads(event['chunk']['bytes'])
                if chunk_data.get('type') == 'content_block_delta' and chunk_data.get('delta', {}).get('text'):
                    text_chunk = chunk_data['delta']['text']
                    print(text_chunk, end='', flush=True)
                    analysis_chunks.append(text_chunk)

        print(f"\n{Fore.MAGENTA}=== End of Response ==={Style.RESET_ALL}")

        # Combine all chunks to return the complete analysis
        analysis = ''.join(analysis_chunks)
        print(f"\n{Fore.GREEN}✓ Analysis completed successfully{Style.RESET_ALL}")
        return analysis

    except Exception as e:
        print(f"\n{Fore.RED}❌ Error invoking Claude: {e}{Style.RESET_ALL}")
        return f"Error analyzing transcript: {e}"

def save_analysis(analysis, output_file="transcript_analysis.txt"):
    """Save the analysis to a file."""
    print(f"\n{Fore.CYAN}[Step 5] Saving analysis to file...{Style.RESET_ALL}")
    try:
        with open(output_file, 'w') as file:
            file.write(analysis)
        print(f"{Fore.GREEN}✓ Analysis saved to {output_file}{Style.RESET_ALL}")
    except Exception as e:
        print(f"{Fore.RED}❌ Error saving analysis: {e}{Style.RESET_ALL}")

def generate_summary(transcript_file: str, output_file: str, prompt_template: str, agenda_text: str, transcript_text: str):
    """
    Generate a summary of the transcript using the provided prompt template.
    
    Args:
        transcript_file (str): Path to the transcript file
        output_file (str): Path where the summary should be saved
        prompt_template (str): Template for the prompt to use
        agenda_text (str): Text content of the agenda
        transcript_text (str): Text content of the transcript
    """
    print(f"\n{Fore.MAGENTA}=== Starting Summary Generation ==={Style.RESET_ALL}")
    
    # Read the transcript
    print(f"\n{Fore.CYAN}[Step 1] Reading transcript file...{Style.RESET_ALL}")
    transcript = read_transcript(transcript_file)
    
    if not transcript:
        print(f"{Fore.RED}❌ Failed to load transcript. Exiting.{Style.RESET_ALL}")
        return False
    
    # Format and save the prompt
    print(f"\n{Fore.CYAN}[Step 2] Formatting and saving prompt...{Style.RESET_ALL}")
    formatted_prompt = prompt_template.format(
        agenda=agenda_text,
        transcript=transcript_text
    )
    with open("prompt.txt", "w") as f:
        f.write(formatted_prompt)
    print(f"{Fore.GREEN}✓ Prompt formatted and saved{Style.RESET_ALL}")
    
    # Analyze the transcript
    print(f"\n{Fore.CYAN}[Step 3] Analyzing transcript...{Style.RESET_ALL}")
    analysis = analyze_transcript(transcript, agenda_text)
    
    # Save the analysis
    print(f"\n{Fore.CYAN}[Step 4] Saving summary...{Style.RESET_ALL}")
    save_analysis(analysis, output_file)
    
    print(f"\n{Fore.MAGENTA}=== Summary Generation Completed ==={Style.RESET_ALL}")
    return True

def main():
    # File paths
    agenda_file = "agenda.txt"
    transcript_file = "sequential_transcript.json"

    print(f"\n{Fore.MAGENTA}=== Starting Transcript Analysis ==={Style.RESET_ALL}")

    # Read the files
    print(f"\n{Fore.CYAN}[Step 1] Reading input files...{Style.RESET_ALL}")
    agenda = read_agenda(agenda_file)
    transcript = read_transcript(transcript_file)

    if not transcript:
        print(f"{Fore.RED}❌ Failed to load transcript. Exiting.{Style.RESET_ALL}")
        return

    print(f"{Fore.GREEN}✓ Input files loaded successfully{Style.RESET_ALL}")

    print(f"\n{Fore.CYAN}[Step 2] Analyzing transcript...{Style.RESET_ALL}")

    # Analyze the transcript
    analysis = analyze_transcript(transcript, agenda)

    # Print the analysis
    print(f"\n{Fore.MAGENTA}=== Analysis Results ==={Style.RESET_ALL}")
    print(analysis)
    print(f"\n{Fore.MAGENTA}=== End of Analysis ==={Style.RESET_ALL}")

    # Save the analysis to a file
    print(f"\n{Fore.CYAN}[Step 3] Saving analysis...{Style.RESET_ALL}")
    save_analysis(analysis)

    print(f"\n{Fore.GREEN}✓ Analysis complete!{Style.RESET_ALL}")

if __name__ == "__main__":
    main()
