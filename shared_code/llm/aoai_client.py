import os
from openai import AzureOpenAI

def get_aoai_client():
    return AzureOpenAI(
        api_key=os.getenv("AOAI_API_KEY"),
        api_version="2024-02-01",
        azure_endpoint=os.getenv("AOAI_ENDPOINT")
    )

def chat_completion(messages: list):
    client = get_aoai_client()
    deployment = os.getenv("AOAI_DEPLOYMENT", "gpt-4o-mini")

    print(f"DEBUG: Calling AOAI [Deploy: {deployment}]...", flush=True)
    try:
        response = client.chat.completions.create(
            model=deployment,
            messages=messages,
            temperature=0.2
        )
        print("DEBUG: AOAI Response received.", flush=True)
        return response.choices[0].message.content
    except Exception as e:
        import logging
        print(f"DEBUG: AOAI Failed: {e}", flush=True)
        logging.getLogger("aoai").error(f"AOAI Error: {e}")
        return None



