import json
import logging
import asyncio
import os
import base64
import audioop
import websockets
import azure.cognitiveservices.speech as speechsdk
from shared_code.agent.agent_engine import run_agent_step

logger = logging.getLogger("twilio-bridge")

class TwilioBridge:
    def __init__(self, speech_key: str, speech_region: str, elevenlabs_api_key: str, voice_id: str = "21m00Tcm4TlvDq8ikWAM"):
        self.speech_key = speech_key
        self.speech_region = speech_region
        self.elevenlabs_api_key = elevenlabs_api_key
        self.voice_id = voice_id
        
        # --- Azure STT Setup ---
        self.speech_config = speechsdk.SpeechConfig(subscription=speech_key, region=speech_region)
        self.speech_config.speech_recognition_language = "en-US"
        
        # Audio format expected from Twilio is 8kHz, but we will convert to 16kHz PCM for Azure for better quality?
        # Actually Azure handles 8kHz well if we tell it.
        # But Twilio sends MULAW. We must decode first.
        self.audio_format = speechsdk.audio.AudioStreamFormat(samples_per_second=8000, bits_per_sample=16, channels=1)
        self.push_stream = speechsdk.audio.PushAudioInputStream(stream_format=self.audio_format)
        self.audio_config = speechsdk.audio.AudioConfig(stream=self.push_stream)
        
        self.recognizer = speechsdk.SpeechRecognizer(speech_config=self.speech_config, audio_config=self.audio_config)
        
        # Hook up events
        self.recognizer.recognized.connect(self._on_recognized)
        # self.recognizer.recognizing.connect(self._on_recognizing) # Optional: Real-time feedback
        self.recognizer.canceled.connect(self._on_canceled)
        
        self.websocket = None
        self.stream_sid = None
        self.session_id = None
        self._is_active = False

    async def handle_websocket(self, websocket):
        self.websocket = websocket
        self._is_active = True
        logger.info("Starting WebSocket loop")
        
        # Start Azure STT
        self.recognizer.start_continuous_recognition()
        
        # Get baseline from query params (passed from twilio_voice_handler in bot_main.py)
        # We need to adapt the websocket object or check if it has query_params
        # Since this is an adapter, we check if it has the attribute
        query_client_id = getattr(websocket, "query_params", {}).get("client_id")
        query_industry = getattr(websocket, "query_params", {}).get("industry")

        try:
            async for message in websocket.iter_text():
                data = json.loads(message)
                event_type = data.get("event")
                
                if event_type == "start":
                    self.stream_sid = data["start"]["streamSid"]
                    call_sid = data["start"].get("callSid")
                    
                    # Use CallSid as Session ID (Persistent for the whole call), not StreamSid (ephemeral)
                    if call_sid:
                        self.session_id = call_sid
                        logger.info(f"Using CallSid as SessionID: {self.session_id}")
                    else:
                        self.session_id = self.stream_sid
                        logger.warning(f"No CallSid found, falling back to StreamSid: {self.session_id}")

                    logger.info(f"Stream started: {self.stream_sid}")
                    
                    # Capture Context Parameters
                    custom_params = data["start"].get("customParameters", {})
                    from_number = custom_params.get("phone_number") or custom_params.get("From")
                    client_id = custom_params.get("client_id") or query_client_id
                    industry = custom_params.get("industry") or query_industry
                    
                    if from_number:
                         # Strip 'client:' prefix if testing from browser
                         if from_number.startswith("client:"):
                             from_number = from_number.replace("client:", "")

                    # IF not resolved from query/custom, try to resolve via Phone Mapping (Source of Truth)
                    # This handles cases where people call the bot directly without passing params
                    if (not client_id or not industry) and from_number:
                        from shared_code.utils.config_loader import load_phone_mappings
                        mappings = load_phone_mappings()
                        
                        # Check strict match
                        if from_number in mappings:
                            client_data = mappings[from_number]
                            client_id = client_data.get("client_id")
                            industry = client_data.get("industry")
                            logger.info(f"Resolved Client via Phone Mapping (Strict): {client_id}")
                        else:
                            # Check fuzzy match
                            clean_number = from_number.lstrip('+')
                            for k, v in mappings.items():
                                if k.lstrip('+') == clean_number:
                                    client_id = v.get("client_id")
                                    industry = v.get("industry")
                                    logger.info(f"Resolved Client via Phone Mapping (Fuzzy): {client_id}")
                                    break
                                     
                    if (not client_id or not industry):
                         logger.warning(f"No client_id or industry resolved. Using hard defaults.")
                         client_id = client_id or os.getenv("CLIENT_ID", "autonova")
                         industry = industry or os.getenv("INDUSTRY", "automotive")
                             
                    from shared_code.utils.session import load_session, save_session
                    session = load_session(self.session_id)
                    
                    if from_number:
                        session["phone_number"] = from_number
                    if client_id:
                        session["client_id"] = client_id
                    if industry:
                        session["industry"] = industry
                        
                    save_session(self.session_id, session)
                    logger.info(f"Captured Session Context: Phone={from_number}, Client={client_id}, Industry={industry}")

                    # Reload config to get the correct voice_id for this specific client
                    if client_id and industry:
                        from shared_code.utils.config_loader import load_merged_config
                        try:
                            config = load_merged_config(client_id, industry)
                            client_voice_id = config.get("elevenlabs_voice_id")
                            if client_voice_id:
                                logger.info(f"Overriding VoiceID for client {client_id}: {client_voice_id}")
                                self.voice_id = client_voice_id
                        except Exception as e:
                            logger.error(f"Failed to load client config for voice override: {e}")

                    # Initial greeting 
                    # CRITICAL: Do NOT block the loop here.
                    asyncio.create_task(self._process_text("__start__"))
                    
                elif event_type == "media":
                    payload = data["media"]["payload"]
                    chunk = base64.b64decode(payload)
                    # Payload is MULAW 8000Hz. Azure PushStream configured for PCM 16-bit 8000Hz.
                    # Convert MULAW -> PCM
                    pcm_chunk = audioop.ulaw2lin(chunk, 2)
                    self.push_stream.write(pcm_chunk)
                    
                elif event_type == "stop":
                    logger.info("Stream stopped by event")
                    break
            
            logger.info("WebSocket loop finished (iter_text ended)")
                    
        except Exception as e:
            # If we explicitly closed the socket (hangup), ignore the error
            if not self._is_active or "WebSocket is not connected" in str(e):
                logger.info("WebSocket closed normally (handled exception).")
            else:
                logger.error(f"WebSocket error in loop: {e}")
                import traceback
                logger.error(traceback.format_exc())
        finally:
            logger.info("Cleaning up WebSocket and Recognizer")
            self._is_active = False
            self.recognizer.stop_continuous_recognition()

    def _on_recognized(self, evt):
        if evt.result.reason == speechsdk.ResultReason.RecognizedSpeech:
            text = evt.result.text
            if text:
                logger.info(f"User said: {text}")
                # We need to bridge from Sync Callback -> Async Agent/TTS
                if hasattr(self, 'loop'):
                     asyncio.run_coroutine_threadsafe(self._process_text(text), self.loop)

    def _on_canceled(self, evt):
        logger.warning(f"Speech canceled: {evt}")

    async def _process_text(self, text):
        if hasattr(self, "_hanging_up") and self._hanging_up:
            logger.info("Ignoring text input because call is hanging up.")
            return

        # 1. Get Agent Response
        logger.info(f"Processing text: {text} | Session: {self.session_id}")
        try:
            response = run_agent_step(self.session_id, text)
        except Exception as e:
            import traceback
            logger.error(f"CRITICAL AGENT ERROR: {e}\n{traceback.format_exc()}")
            return

        reply_text = response.get("prompt")
        
        # Check for Hangup Signal
        should_hangup = False
        if reply_text and "[HANGUP]" in reply_text:
            reply_text = reply_text.replace("[HANGUP]", "").strip()
            should_hangup = True
            self._hanging_up = True # Block further inputs
            logger.info("Hangup signal detected. Blocking further input.")
        
        if reply_text:
            logger.info(f"Agent reply: {reply_text}")
            # 2. Convert to Speech (ElevenLabs optimized)
            # Use optimized stream with Turbo model
            await self._stream_elevenlabs_tts_optimized(reply_text)
            
        if should_hangup:
            logger.info("Closing socket due to HANGUP signal.")
            # Give a small delay for audio to flush
            await asyncio.sleep(8)
            if self.websocket:
                await self.websocket.close()

    async def _stream_elevenlabs_tts_optimized(self, text):
        # Better implementation: use output_format=ulaw_8000 directly
        url = f"wss://api.elevenlabs.io/v1/text-to-speech/{self.voice_id}/stream-input?model_id=eleven_turbo_v2_5&output_format=ulaw_8000"
        
        header = {
            "xi-api-key": self.elevenlabs_api_key or os.getenv("ELEVENLABS_API_KEY")
        }
        
        try:
            async with websockets.connect(url, extra_headers=header) as ws:
                await ws.send(json.dumps({
                    "text": text,
                    "try_trigger_generation": True
                }))
                await ws.send(json.dumps({"text": ""})) # EOS

                async for message in ws:
                    data = json.loads(message)
                    audio_b64 = data.get("audio")
                    
                    if audio_b64:
                        # Direct u-law chunks from ElevenLabs
                        await self._send_media_to_twilio(audio_b64)
                        
                    if data.get("isFinal"):
                        break
        except Exception as e:
            logger.error(f"ElevenLabs TTS Error: {e}")

    async def _send_media_to_twilio(self, b64_audio):
        if self.websocket and self.stream_sid:
            msg = {
                "event": "media",
                "streamSid": self.stream_sid,
                "media": {
                    "payload": b64_audio
                }
            }
            try:
                # Check for closed socket explicitly if possible, or just try
                await self.websocket.send_text(json.dumps(msg))
            except Exception as e:
                # Catch "Unexpected ASGI message" or "Connection closed"
                logger.warning(f"Failed to send media to Twilio (Connection likely closed): {e}")
                pass

    # Add loop setter for thread safety bridge
    def set_loop(self, loop):
        self.loop = loop
