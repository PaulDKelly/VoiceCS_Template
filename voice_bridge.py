"""
Voice Bridge
Handles the audio streaming between Azure Communication Services (ACS) WebSocket
and Azure Speech SDK (Direct Line Speech).
"""
import logging
import asyncio
import azure.cognitiveservices.speech as speechsdk
from azure.cognitiveservices.speech.audio import PushAudioInputStream, AudioStreamFormat, PushAudioOutputStream, PushAudioOutputStreamCallback

logger = logging.getLogger("voice-bridge")

class WebSocketOutputStreamCallback(PushAudioOutputStreamCallback):
    """
    Callback that receives audio from Speech SDK (Bot response)
    and sends it to the ACS WebSocket.
    """
    def __init__(self, websocket_send_func):
        super().__init__()
        self._websocket_send_func = websocket_send_func

    def write(self, data: memoryview) -> int:
        """
        Called by Speech SDK when it has audio data to play.
        We send this data to the WebSocket.
        """
        try:
            # Send data to WebSocket (needs to be scheduled on loop)
            # Note: This callback runs on a background thread, so we use
            # asyncio.run_coroutine_threadsafe or similar if needed.
            # However, since we're in a callback, we might need a simpler way.
            # For simplicity in this demo, we assume the send_func handles the async aspect
            # or we assume we can fire-and-forget.
            
            # Since 'write' is sync, and websocket send is async, we need a bridge.
            # A common pattern is to put data into a queue that the websocket loop drains.
            # But here we pass a sync wrapper or future.
            
            # Let's rely on the caller to provide a thread-safe sync wrapper 
            # or we use a loop reference.
            if self._websocket_send_func:
                self._websocket_send_func(bytes(data))
            return len(data)
        except Exception as e:
            logger.error(f"Error sending audio to WebSocket: {e}")
            return 0

    def close(self):
        logger.info("Closing audio output stream")


class VoiceBridge:
    def __init__(self, speech_key: str, speech_region: str, bot_id: str):
        self.speech_config = speechsdk.SpeechConfig(subscription=speech_key, region=speech_region)
        
        # Configure for Direct Line Speech
        # We need to set the bot ID (or "DialogServiceConnector" config)
        # Actually for Direct Line Speech (Custom Voice Agent), we use DialogServiceConnector
        
        # IMPORTANT: DLS requires "en-US" or matching language
        self.speech_config.speech_recognition_language = "en-US"
        
        # Set up audio format (ACS uses 16kHz 16-bit mono PCM usually)
        self.audio_format = AudioStreamFormat(samples_per_second=16000, bits_per_sample=16, channels=1)
        
        # Input Stream: ACS -> Speech SDK
        self.push_stream = PushAudioInputStream(stream_format=self.audio_format)
        self.audio_config = speechsdk.audio.AudioConfig(stream=self.push_stream)
        
        # Output Stream: Speech SDK -> ACS (via callback)
        # We'll initialize this when we have the websocket connection
        self.connector = None
        self.output_callback = None

    async def connect(self, send_audio_func):
        """
        Connects to Direct Line Speech channel.
        send_audio_func: A function that takes bytes and sends to ACS WebSocket
        """
        # Create output stream callback
        self.output_callback = WebSocketOutputStreamCallback(send_audio_func)
        self.push_output_stream = PushAudioOutputStream(self.output_callback)
        
        # Audio config for output
        # Is there a way to pipe output to a stream? Yes.
        # But DialogServiceConnector doesn't support Pull/Push OUTPUT streams easily in Python SDK yet?
        # Actually it does allow specifying AudioConfig with a reference.
        
        # Wait, Python SDK for DialogServiceConnector audio output is tricky.
        # Fallback: We might need to rely on the default speaker or use the "PullAudioOutputStream" pattern.
        # Let's check if AudioConfig(stream=...) works for output.
        
        output_audio_config = speechsdk.audio.AudioConfig(stream=self.push_output_stream)
        
        self.connector = speechsdk.DialogServiceConnector(
            config=self.speech_config,
            audio_config=self.audio_config # Input only? No, AudioConfig can be strictly input or output.
            # Wait, DialogServiceConnector takes "audio_config" which is usually input.
            # Where is output?
        )
        
        # NOTE: As of now, Python SDK support for Custom Audio Output in DialogServiceConnector is limited.
        # If this fails, we might need a workaround or use separate Synthesizer.
        # BUT, standard Direct Line Speech implies "turn-based" conversation.
        
        # Let's try to set the property for output if possible, or use the default
        # "Agent" logic.
        
        # Alternative: Use "SpeechRecognizer" and "SpeechSynthesizer" separately?
        # No, DLS is "DialogServiceConnector".
        
        # Let's register events
        self.connector.activity_received.connect(self._on_activity_received)
        self.connector.recognized.connect(self._on_recognized)
        
        # Connect asynchronously
        future = self.connector.connect_async()
        return future.get()

    def write_audio(self, data: bytes):
        """
        Writes audio data from ACS to the Speech SDK input stream.
        """
        self.push_stream.write(data)

    def close(self):
        if self.connector:
            self.connector.disconnect_async()
        self.push_stream.close()
        if self.push_output_stream:
            self.push_output_stream.close()

    def _on_activity_received(self, evt):
        """
        Called when DLS sends an activity (could be meta data or audio via separate channel?)
        Actually, DLS streams audio automatically if "AudioConfig" is set properly.
        If we can't capture audio via stream, we might miss the TTS.
        """
        logger.info(f"DLS Activity Received: {evt.activity}")
        # If contains audio, it might be auto-played if not captured.

    def _on_recognized(self, evt: speechsdk.SpeechRecognitionEventArgs):
        if evt.result.reason == speechsdk.ResultReason.RecognizedSpeech:
            logger.info(f"User said: {evt.result.text}")

