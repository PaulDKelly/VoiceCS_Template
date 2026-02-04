"""Bot test with detailed error info"""
import requests
import json

msg = {
    "type": "message",
    "channelId": "emulator",
    "serviceUrl": "http://localhost:8000",
    "from": {"id": "user1"},
    "conversation": {"id": "conv1"},
    "recipient": {"id": "bot"},
    "text": "Hello"
}

print("Sending message to bot...")
try:
    r = requests.post("http://localhost:8000/api/messages", json=msg, timeout=5)
    print(f"Status: {r.status_code}")
    print(f"Response: {r.text}")
    if r.status_code != 200:
        try:
            error = r.json()
            print(f"Error details: {json.dumps(error, indent=2)}")
        except:
            pass
except Exception as e:
    print(f"Exception: {e}")
