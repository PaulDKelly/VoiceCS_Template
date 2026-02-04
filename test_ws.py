import asyncio
import websockets
import json

URI = "wss://voicecs-agent.ashysky-8dede81f.uksouth.azurecontainerapps.io/media"

async def test_connection():
    print(f"Connecting to {URI}...")
    try:
        async with websockets.connect(URI) as websocket:
            print("Connected!")
            
            # Send a fake init message like ACS does
            msg = {
                "kind": "CallMetadata",
                "callConnectionId": "test-connection-id",
                "correlationId": "test-correlation-id"
            }
            await websocket.send(json.dumps(msg))
            print("Sent init message.")
            
            response = await websocket.recv()
            print(f"Received: {len(response)} bytes") # Likely audio if it works
            
    except Exception as e:
        print(f"Connection failed: {e}")

if __name__ == "__main__":
    asyncio.run(test_connection())
