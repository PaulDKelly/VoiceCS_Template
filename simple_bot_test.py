"""Simple bot test with clear output"""
import requests
print("Testing Bot @ http://localhost:8000")
print("=" * 50)

# Test health
r = requests.get("http://localhost:8000/health")
print(f"1. Health: {r.status_code} - {r.text}")

# Test message
msg = {
    "type": "message",
    "channelId": "emulator",
    "serviceUrl": "http://localhost:8000",
    "from": {"id": "user1"},
    "conversation": {"id": "conv1"},
    "recipient": {"id": "bot"},
    "text": "Hello"
}
r = requests.post("http://localhost:8000/api/messages", json=msg)
print(f"2. Message: {r.status_code} - {r.text if r.text else '(empty - SUCCESS!)'}")

print("=" * 50)
print("RESULT: Bot is", "WORKING!" if r.status_code == 200 else f"ERROR {r.status_code}")
