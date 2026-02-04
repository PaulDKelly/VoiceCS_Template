import asyncio
import websockets
import json

async def test_ws():
    uri = "ws://localhost:8000/api/audio-twilio"
    print(f"Attempting connection to {uri}...")
    
    try:
        async with websockets.connect(uri) as websocket:
            print("Status: Connected!")
            
            # Send a dummy start message
            msg = {
                "event": "start",
                "start": {
                    "streamSid": "test_stream",
                    "callSid": "test_call"
                }
            }
            await websocket.send(json.dumps(msg))
            print("Sent: start event")
            
            # Wait for a bit (server logs should show 'Twilio WebSocket connected')
            await asyncio.sleep(1)
            print("Test finished successfully.")
            
    except Exception as e:
        print(f"Connection Failed: {e}")

if __name__ == "__main__":
    loop = asyncio.new_event_loop()
    loop.run_until_complete(test_ws())
