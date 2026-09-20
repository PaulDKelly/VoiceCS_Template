"""
Realtime Voice Bridge
Handles the audio streaming between ACS/Twilio WebSocket and Azure OpenAI Realtime API.
"""
import logging
import asyncio
import os
import json
import base64
import websockets

logger = logging.getLogger("realtime-voice-bridge")

class RealtimeVoiceBridge:
    def __init__(self, api_key: str, endpoint: str, model: str, audio_format: str = "pcm16"):
        self.api_key = api_key
        # Cleanup endpoint URL
        endpoint = endpoint.rstrip("/")
        
        if "https://" in endpoint:
            self.endpoint = endpoint.replace("https://", "wss://")
        else:
            self.endpoint = endpoint
            
        if not self.endpoint.startswith("wss://"):
            self.endpoint = f"wss://{self.endpoint}"
            
        # Append path for Realtime API
        if "openai.azure.com" in self.endpoint:
            self.endpoint = f"{self.endpoint}/openai/realtime?api-version=2024-10-01-preview&deployment={model}"
        
        self.model = model
        self.audio_format = audio_format
        self.ws = None
        self._is_active = False

    async def start(self, send_audio_func):
        """
        Connects to the OpenAI Realtime API and starts the event processing loop.
        send_audio_func: A coroutine that takes bytes and sends them to the ACS/Twilio WebSocket.
        """
        headers = {
            "api-key": self.api_key,
            "OpenAI-Beta": "realtime=v1"
        }
        
        logger.info(f"Connecting to Realtime API: {self.endpoint.split('?')[0]}...")
        
        try:
            async with websockets.connect(self.endpoint, extra_headers=headers) as ws:
                self.ws = ws
                self._is_active = True
                logger.info("Connected to Azure OpenAI Realtime API")
                
                # Session Initialization
                await self._initialize_session()
                
                # Receive Loop
                async for message in ws:
                    if not self._is_active:
                        break
                        
                    try:
                        data = json.loads(message)
                        event_type = data.get("type")
                        
                        if event_type == "response.audio.delta":
                            # Received audio from AI
                            delta_b64 = data.get("delta")
                            if delta_b64:
                                audio_bytes = base64.b64decode(delta_b64)
                                await send_audio_func(audio_bytes)
                                
                        elif event_type == "error":
                            logger.error(f"Realtime API Error: {data.get('error')}")
                            
                        elif event_type == "input_audio_buffer.speech_started":
                            logger.info("AI detected user speech start")
                            # Optional: Send clear buffer logic here
                            
                    except Exception as e:
                        logger.error(f"Error processing message: {e}")
                        
        except Exception as e:
            logger.exception(f"Connection failed to Realtime API: {e}")
        finally:
            self._is_active = False
            logger.info("Realtime bridge stopped")

    async def _initialize_session(self):
        """Sends initial session configuration."""
        # Determine Audio Format
        if self.audio_format == "mulaw":
            # Twilio Format
            fmt = "g711_ulaw"
        else:
            # ACS Format
            fmt = "pcm16"
            
        session_update = {
            "type": "session.update",
            "session": {
                "modalities": ["text", "audio"],
                "instructions": (
                    "You are a helpful and friendly AI customer service agent for Fortell Autos. "
                    "Keep your responses concise and naturally conversational. "
                    "You can help with warranty claims, booking service, or sales."
                ),
                "voice": "alloy",
                "input_audio_format": fmt,
                "output_audio_format": fmt,
                "input_audio_transcription": {
                    "model": "whisper-1"
                },
                "turn_detection": {
                    "type": "server_vad",
                    "threshold": 0.5,
                    "prefix_padding_ms": 300,
                    "silence_duration_ms": 1200
                }
            }
        }
        await self.ws.send(json.dumps(session_update))
        logger.info(f"Session initialized with format: {fmt}")

    async def write_audio(self, audio_bytes: bytes):
        """
        Sends audio data from ACS/Twilio to the Realtime API.
        """
        if self.ws and self._is_active:
            try:
                # Send AppendAudioBuffer event
                # Expects base64 encoded string
                b64_audio = base64.b64encode(audio_bytes).decode("utf-8")
                
                event = {
                    "type": "input_audio_buffer.append",
                    "audio": b64_audio
                }
                await self.ws.send(json.dumps(event))
            except Exception as e:
                logger.error(f"Error sending audio to AI: {e}")

    def stop(self):
        self._is_active = False
        # WS closing is handled by the context manager in start()

