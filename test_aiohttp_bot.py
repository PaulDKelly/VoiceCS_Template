"""
Direct test of the aiohttp bot endpoint
Sends actual Bot Framework activities to test the bot
"""
import requests
import json
from datetime import datetime

BASE_URL = "http://localhost:8000"

print("=" * 60)
print("TESTING AIOHTTP BOT ENDPOINT")
print("=" * 60)
print()

# Test 1: Health check
print("Test 1: Health Check")
response = requests.get(f"{BASE_URL}/health")
print(f"Status: {response.status_code}")
print(f"Response: {response.json()}")
print()

# Test 2: Send conversationUpdate (simulates user connecting)
print("Test 2: ConversationUpdate (User Connects)")
conversation_update = {
    "type": "conversationUpdate",
    "id": "test-conv-update-001",
    "timestamp": datetime.utcnow().isoformat() + "Z",
    "channelId": "emulator",
    "serviceUrl": "http://localhost:8000",
    "from": {
        "id": "user123",
        "name": "Test User"
    },
    "conversation": {
        "id": "test-conversation-001"
    },
    "recipient": {
        "id": "bot",
        "name": "VoiceCS Bot"
    },
    "membersAdded": [
        {
            "id": "user123",
            "name": "Test User"
        }
    ]
}

response = requests.post(
    f"{BASE_URL}/api/messages",
    json=conversation_update,
    headers={"Content-Type": "application/json"}
)
print(f"Status: {response.status_code}")
print(f"Response: {response.text if response.text else '(empty)'}")
print()

# Test 3: Send message
print("Test 3: Message Activity (User says 'Hello')")
message = {
    "type": "message",
    "id": "test-message-001",
    "timestamp": datetime.utcnow().isoformat() + "Z",
    "channelId": "emulator",
    "serviceUrl": "http://localhost:8000",
    "from": {
        "id": "user123",
        "name": "Test User"
    },
    "conversation": {
        "id": "test-conversation-001"
    },
    "recipient": {
        "id": "bot",
        "name": "VoiceCS Bot"
    },
    "text": "Hello"
}

response = requests.post(
    f"{BASE_URL}/api/messages",
    json=message,
    headers={"Content-Type": "application/json"}
)
print(f"Status: {response.status_code}")
print(f"Response: {response.text if response.text else '(empty)'}")
print()

print("=" * 60)
print("CHECK SERVER LOGS FOR:")
print("  - 'Incoming request: POST /api/messages'")
print("  - '[Session: ...] Call started, sending greeting'")
print("  - '[Session: ...] User said: Hello'")
print("  - '[Session: ...] Agent reply: ...'")
print("=" * 60)
