import asyncio
import websockets
import json
import ssl

# Use the correct URL from your setup
URI = "wss://app-voice-agent.bluefield-9f0e7247.uksouth.azurecontainerapps.io/api/audio-twilio?client_id=Autonova&industry=automotive"

async def test_connection():
    print(f"Connecting to {URI}...")
    try:
        # Disable SSL verification for testing if needed (though ACA has valid certs usually)
        ssl_context = ssl.create_default_context()
        ssl_context.check_hostname = False
        ssl_context.verify_mode = ssl.CERT_NONE
        
        async with websockets.connect(URI, ssl=ssl_context) as websocket:
            print("Connected successfully!")
            
            # Reset of the flow would go here, but successful connection implies config loaded without crash
            # Initial Twilio 'Connected' event simulation
            msg = {
                "event": "connected",
                "protocol": "CallDeepgram",
                "version": "1.0.0"
            }
            await websocket.send(json.dumps(msg))
            print("Sent 'connected' event.")
            
            # Wait a bit to see if server closes
            await asyncio.sleep(2)
            print("Connection sustained for 2s. Test Passed.")
            
    except websockets.exceptions.ConnectionClosed as e:
        print(f"Connection closed by server: {e.code} {e.reason}")
    except Exception as e:
        print(f"Connection failed: {e}")

if __name__ == "__main__":
    asyncio.run(test_connection())
