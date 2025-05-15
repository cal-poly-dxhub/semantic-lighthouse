import boto3
import json

def invoke_claude_cross_region():
    bedrock_runtime = boto3.client(
        service_name='bedrock-runtime',
        region_name='us-west-2'
    )

    request_body = {
        "anthropic_version": "bedrock-2023-05-31",
        "max_tokens": 1000,
        "temperature": 0.7,
        "messages": [
            {
                "role": "user",
                "content": "What is the capital of Colombia?"
            }
        ]
    }

    modelId='us.anthropic.claude-3-7-sonnet-20250219-v1:0'

    try:
        response = bedrock_runtime.invoke_model(
            modelId=modelId,
            contentType='application/json',
            accept='application/json',
            body=json.dumps(request_body)
        )

        # Parse the response
        response_body = json.loads(response['body'].read())

        # Print the response
        print(f"Response from modelId {modelId}:")
        print(response_body['content'][0]['text'])
        return response_body
    except Exception as e:
        print(f"Error invoking Claude: {e}")
        raise

if __name__ == "__main__":
    invoke_claude_cross_region()
