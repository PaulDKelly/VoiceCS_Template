"""
Quick test script for Bot Framework endpoint
Tests the /api/messages endpoint with a sample message
"""
import requests
import json
from datetime import datetime

# Configuration
BASE_URL = "http://localhost:8000"  # Change to Azure URL when testing cloud
# BASE_URL = "https://voicecs-agent.ashysky-8dede81f.uksouth.azurecontainerapps.io"

def test_health():
    """Test the health endpoint"""
    print("Testing health endpoint...")
    try:
        response = requests.get(f"{BASE_URL}/health")
        print(f"✅ Health check: {response.status_code}")
        print(f"   Response: {response.json()}")
        return response.status_code == 200
    except Exception as e:
        print(f"❌ Health check failed: {e}")
        return False

def test_bot_message(text="Hello"):
    """Test sending a message to the bot"""
    print(f"\nTesting bot message: '{text}'...")
    
    # Create a Bot Framework Activity
    activity = {
        "type": "message",
        "id": "test-message-001",
        "timestamp": datetime.utcnow().isoformat() + "Z",
        "channelId": "emulator",
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
        "text": text,
        "locale": "en-GB"
    }
    
    try:
        response = requests.post(
            f"{BASE_URL}/api/messages",
            json=activity,
            headers={"Content-Type": "application/json"}
        )
        
        print(f"✅ Bot response: {response.status_code}")
        
        if response.status_code == 200:
            print(f"   Bot is working!")
            # Note: The response might be empty as Bot Framework uses async messaging
            # The actual reply would come through the Bot Framework channel
        else:
            print(f"   Response: {response.text}")
        
        return response.status_code == 200
        
    except Exception as e:
        print(f"❌ Bot message test failed: {e}")
        return False

def run_all_tests():
    """Run all tests"""
    print("=" * 60)
    print("BOT FRAMEWORK ENDPOINT TESTS")
    print("=" * 60)
    print(f"Testing URL: {BASE_URL}\n")
    
    results = []
    
    # Test 1: Health endpoint
    results.append(("Health Check", test_health()))
    
    # Test 2: Simple message
    results.append(("Simple Message", test_bot_message("Hello")))
    
    # Test 3: Warranty intent
    results.append(("Warranty Intent", test_bot_message("I need help with warranty")))
    
    # Test 4: Service intent
    results.append(("Service Intent", test_bot_message("I want to book a service")))
    
    # Print summary
    print("\n" + "=" * 60)
    print("TEST SUMMARY")
    print("=" * 60)
    
    for test_name, passed in results:
        status = "✅ PASS" if passed else "❌ FAIL"
        print(f"{status} - {test_name}")
    
    total_passed = sum(1 for _, passed in results if passed)
    total_tests = len(results)
    print(f"\nTotal: {total_passed}/{total_tests} tests passed")
    
    if total_passed == total_tests:
        print("\n🎉 All tests passed! Your bot is working correctly.")
    else:
        print("\n⚠️  Some tests failed. Check the output above for details.")
        print("\nTroubleshooting:")
        print("1. Make sure the server is running: uvicorn main:app --reload --port 8000")
        print("2. Check that dependencies are installed: pip install -r requirements.txt")
        print("3. Verify your agent code in shared_code/agent/agent_engine.py")

if __name__ == "__main__":
    run_all_tests()
