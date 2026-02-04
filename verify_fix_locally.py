import requests
import json
import os

# Configuration
# NO Sidecar, direct to Agent
AGENT_URL = "http://localhost:5045/acs/callhandler"

# Simulate ACS Event Grid Payload
payload = [
    {
        "id": "1234",
        "eventType": "Microsoft.Communication.IncomingCall",
        "subject": "calling/callConnections/123",
        "eventTime": "2024-01-24T12:00:00Z",
        "dataVersion": "1.0",
        "data": {
            "incomingCallContext": {
                "incomingCallContext": "test-context-string-hidden-in-object"
            },
            "from": {"rawId": "user1"},
            "to": {"rawId": "bot1"}
        }
    }
]

print(f"Sending payload to {AGENT_URL}...")
try:
    response = requests.post(AGENT_URL, json=payload)
    print(f"Status Code: {response.status_code}")
    print(f"Response: {response.text}")
except Exception as e:
    print(f"Failed to connect: {e}")
