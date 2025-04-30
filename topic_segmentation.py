import json
import boto3
import re
from collections import defaultdict
from botocore.exceptions import ClientError

MODEL_ID = "anthropic.claude-3-5-sonnet-20241022-v2:0"


def parse_transcription_job(transcription_file_path: str):
    with open(transcription_file_path, "r") as transcription_file:
        json_data = transcription_file.read()
        text_data = json.loads(json_data)

    audio_segments = text_data.get("results").get("audio_segments")
    formatted_segments = []
    current_speaker = None
    current_text = []
    
    for segment in audio_segments:
        speaker_label = segment.get("speaker_label")
        
        if speaker_label != current_speaker:
            if current_speaker and current_text:
                formatted_segments.append((current_speaker, " ".join(current_text)))
            current_speaker = speaker_label
            current_text = []
            
        current_text.append(segment.get("transcript"))
    
    if current_speaker and current_text:
        formatted_segments.append((current_speaker, " ".join(current_text)))

    return formatted_segments

def is_discussion(context: str):
    with open("determine_discussion_prompt.txt", "r") as infile:
        prompt = infile.read()
    return "YES" in invoke_model(prompt, context)

def determine_discussions(speaker_chunks, group_size=5):
    discussions = []
    for idx in range(1, len(speaker_chunks) - group_size):
        context = []
        for increment in range(-1, group_size + 1):
            context.append(speaker_chunks[idx + increment])
        context = "".join(context)
        if is_discussion(context):
            discussions.append(context)

    return discussions

def summarize_item_discussion(item_to_discussion):
    summarized_items = {}
    with open("item_summary_prompt.txt", "r") as summary_prompt_file:
        prompt = summary_prompt_file.read()
    for item, discussion in item_to_discussion.items():
        formatted_context = f"Item: {item}\nDiscussion: {discussion}"
        summary = invoke_model(prompt, formatted_context)
        summarized_items[item] = summary
    return summarized_items

def get_agenda_items(agenda_file_path):
    with open(agenda_file_path, "r") as agenda_file:
        agenda_items = agenda_file.read()

    return agenda_items

def match_discussion_to_item(discussions, agenda_items):
    with open("discussion_matching_prompt.txt", "r") as prompt_file:
        prompt = prompt_file.read()
    item_to_discussion = defaultdict(list)
    for discussion in discussions:
        formatted_context = f"Discussion: {discussion}\nAgenda Items: {agenda_items}"
        response = invoke_model(prompt, formatted_context)
        result = re.search('<Item>(.*?)</Item>', response)
        if result:
            relevant_item = result.group(1)
        if "None" not in relevant_item:
            print(f"Matched discussion for {relevant_item}")
            item_to_discussion[relevant_item].append(discussion)
    return item_to_discussion

def write_to_output(formatted_data, output_file):
    with open(output_file, "w") as outfile:
        for speaker, output in formatted_data:
            outfile.write(f"Speaker: {speaker}\nText: {"".join(output)}\n\n")


def invoke_model(prompt: str, context: str):
    bedrock_client = boto3.client("bedrock-runtime")
    user_message = f"{prompt}\nContext: {context}"
    conversation = [
        {
            "role": "user",
            "content": [{"text": user_message}]
        }
    ]
    try:
        response = bedrock_client.converse(
            modelId=MODEL_ID,
            messages=conversation,
            inferenceConfig={"maxTokens": 8192, "temperature": 0.0}
        )

        response_text = response["output"]["message"]["content"][0]["text"]
        return response_text
    except (ClientError, Exception) as e:
        print(f"ERROR: Can't invoke {MODEL_ID}. Reason: {e}")
        exit(1)

def main(group_size):
    transcription_file_path = '/Users/nasrulah/Work/Projects/semantic-lighthouse/asrOutput.json'
    formatted_segments = parse_transcription_job(transcription_file_path)

    agenda_file_path = '/Users/nasrulah/Work/Projects/semantic-lighthouse/agenda_items.txt'  # You'll need to specify the correct path
    agenda_items = get_agenda_items(agenda_file_path)

    speaker_chunks = [f"{speaker}: {text}" for speaker, text in formatted_segments]
    discussions = determine_discussions(speaker_chunks)
    
    item_to_discussion = match_discussion_to_item(discussions, agenda_items)
    
    summarized_items = summarize_item_discussion(item_to_discussion)
    
    output_file_path = f'meeting_summary_{group_size}_chunks.txt'
    with open(output_file_path, 'w') as f:
        f.write("Meeting Summary\n")
        f.write("==============\n\n")
        for item, summary in summarized_items.items():
            f.write(f"Agenda Item: {item}\n")
            f.write(f"Summary: {summary}\n")
            f.write("-" * 50 + "\n\n")
    
    print(f"Meeting summary has been written to {output_file_path} for group size {group_size}")


if __name__ == '__main__':
    group_sizes = [x for x in range(1, 7)]
    for group_size in group_sizes:
        try:
            main(group_size)
        except Exception as e:
            print(e)
            continue