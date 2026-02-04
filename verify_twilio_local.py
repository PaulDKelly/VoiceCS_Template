import asyncio
import websockets
import json
import base64
import time

# Mock U-law silence (0xFF is silence in u-law)
SILENCE_CHUNK = base64.b64encode(b'\xff' * 160).decode('utf-8') # 20ms of silence at 8khz

async def verify_twilio_stream():
    uri = "ws://localhost:8000/api/audio-twilio"
    print(f"Connecting to {uri}...")
    
    try:
        async with websockets.connect(uri) as websocket:
            print("Connected!")
            
            # Send 'start' event
            start_msg = {
                "event": "start",
                "start": {
                    "streamSid": "TEST_STREAM_SID_12345",
                    "callSid": "TEST_CALL_SID"
                }
            }
            await websocket.send(json.dumps(start_msg))
            print("Sent start event.")
            
            # Send 'media' event (simulate 1 second of silence)
            # In reality, we'd send speech here to trigger the agent.
            # But just keeping the connection open and sending data validates the loop.
            print("Sending audio chunks...")
            for _ in range(50):
                media_msg = {
                    "event": "media",
                    "streamSid": "TEST_STREAM_SID_12345",
                    "media": {
                        "payload": SILENCE_CHUNK
                    }
                }
                await websocket.send(json.dumps(media_msg))
                await asyncio.sleep(0.02) # 20ms
                
            # Keep listening for a bit
            print("Listening for responses...")
            try:
                msg = await asyncio.wait_for(websocket.recv(), timeout=5.0)
                print(f"Received message: {msg}")
            except asyncio.TimeoutError:
                print("No response received within 5s (expected if we only sent silence and no greeting triggered automatically)")
                
            print("Test complete.")
            
    except Exception as e:
        print(f"Verification Failed: {e}")

if __name__ == "__main__":
    asyncio.run(verify_twilio_stream())
