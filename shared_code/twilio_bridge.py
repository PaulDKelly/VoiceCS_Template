import json
import logging
import asyncio
import os
import base64
import audioop
import websockets
import time
import re
from typing import Optional
import azure.cognitiveservices.speech as speechsdk
from shared_code.agent.agent_engine import run_agent_step
from shared_code.utils.call_trace import append_call_trace
from shared_code.voice.turn_detection import (
    AudioActivityDetector,
    DuplicateUtteranceGuard,
    build_typing_ulaw,
)
from shared_code.voice.conversation_runtime import ConversationRuntime, TurnToken

logger = logging.getLogger("twilio-bridge")


def _to_bool(value) -> bool:
    return str(value or "").strip().lower() in ("1", "true", "yes", "on")


def _is_valid_azure_region(value: str) -> bool:
    region = str(value or "").strip().lower()
    if not region:
        return False
    return re.fullmatch(r"[a-z0-9-]{2,32}", region) is not None


def _is_valid_locale(value: str) -> bool:
    locale = str(value or "").strip()
    if not locale:
        return False
    return re.fullmatch(r"[a-z]{2,3}-[A-Za-z]{2,4}", locale) is not None

class TwilioBridge:
    def __init__(self, speech_key: str, speech_region: str, elevenlabs_api_key: str, voice_id: str = "21m00Tcm4TlvDq8ikWAM"):
        self.speech_key = speech_key
        self.speech_region = speech_region
        self.elevenlabs_api_key = elevenlabs_api_key
        self.voice_id = voice_id
        self.elevenlabs_model_id = os.getenv("ELEVENLABS_MODEL_ID", "eleven_turbo_v2_5")
        self.elevenlabs_voice_settings = {
            "stability": float(os.getenv("ELEVENLABS_STABILITY", "0.45")),
            "similarity_boost": float(os.getenv("ELEVENLABS_SIMILARITY_BOOST", "0.8")),
            "style": float(os.getenv("ELEVENLABS_STYLE", "0.15")),
            "use_speaker_boost": True,
        }
        self.tts_provider = "elevenlabs"
        self.azure_voice_name = None
        self.azure_speech_region = self.speech_region
        self.azure_ssml_lang = "en-GB"
        self.azure_voice_style = None
        self.azure_voice_style_degree = None
        self._tts_cache = {}
        self._tts_cache_limit = 200
        self._client_config = None
        self._speaking = False
        self._speaking_started_at = 0.0
        self._barge_in_threshold_ms = int(os.getenv("BARGE_IN_GRACE_MS", "550"))
        self._barge_in_triggered = False
        self._barge_in_enabled = _to_bool(os.getenv("BARGE_IN_ENABLED", "1"))
        self._activity_detector = AudioActivityDetector(
            rms_threshold=int(os.getenv("BARGE_IN_RMS_THRESHOLD", "500")),
            min_speech_ms=int(os.getenv("BARGE_IN_MIN_SPEECH_MS", "240")),
            release_ms=int(os.getenv("BARGE_IN_RELEASE_MS", "180")),
        )
        self._duplicate_guard = DuplicateUtteranceGuard(
            window_seconds=float(os.getenv("DUPLICATE_UTTERANCE_WINDOW_S", "1.75"))
        )
        self._turn_lock = asyncio.Lock()
        self._runtime = ConversationRuntime()
        self._transcript_task = None
        self._pending_transcript = ""
        self._pending_confidence = None
        self._transcript_settle_s = float(os.getenv("TRANSCRIPT_SETTLE_MS", "320")) / 1000.0
        self._mark_counter = 0
        self._pending_marks = {}
        self._progress_delay_s = float(os.getenv("PROGRESS_FEEDBACK_DELAY_S", "2.0"))
        self._progress_typing_enabled = _to_bool(os.getenv("PROGRESS_TYPING_ENABLED", "1"))
        self._progress_index = 0
        self._progress_active = False
        self.noise_mode = _to_bool(os.getenv("AZURE_STT_NOISE_MODE", "1"))
        self.min_stt_confidence = float(os.getenv("AZURE_STT_MIN_CONFIDENCE", "0.45"))
        self.min_name_confidence = float(os.getenv("AZURE_STT_NAME_MIN_CONFIDENCE", "0.18"))
        self._echo_guard_ms = int(os.getenv("AZURE_STT_ECHO_GUARD_MS", "900"))
        self._post_tts_guard_until = 0.0
        self._clarify_prompt = "Sorry, I caught background noise there. Could you repeat that briefly?"
        self._no_response_timeout_s = float(os.getenv("NO_RESPONSE_TIMEOUT_S", "6.5"))
        self._no_response_reprompt_max = int(os.getenv("NO_RESPONSE_REPROMPT_MAX", "2"))
        self._no_response_reprompts = 0
        self._no_response_task = None
        self._last_user_speech_at = 0.0
        self._last_prompt_at = 0.0
        self._expecting_name = False
        
        self.stt_language = os.getenv("AZURE_STT_LANGUAGE", "en-GB")

        # Audio format expected from Twilio is 8kHz, but we will convert to 16kHz PCM for Azure for better quality?
        # Actually Azure handles 8kHz well if we tell it.
        # But Twilio sends MULAW. We must decode first.
        self.audio_format = speechsdk.audio.AudioStreamFormat(samples_per_second=8000, bits_per_sample=16, channels=1)
        self.speech_config = None
        self.push_stream = None
        self.audio_config = None
        self.recognizer = None
        self._build_stt_pipeline(self.stt_language)

        self.websocket = None
        self.stream_sid = None
        self.session_id = None
        self._is_active = False
        self._emit_sim_events = False
        self._recognition_started = False
        self._received_media_frames = 0

    def _start_recognition(self):
        if self._recognition_started:
            return
        self.recognizer.start_continuous_recognition()
        self._recognition_started = True

    def _stop_recognition(self):
        if not self._recognition_started:
            return
        self.recognizer.stop_continuous_recognition()
        self._recognition_started = False

    def _build_stt_pipeline(self, language: str):
        self.speech_config = speechsdk.SpeechConfig(subscription=self.speech_key, region=self.speech_region)
        self.speech_config.speech_recognition_language = language
        try:
            self.speech_config.output_format = speechsdk.OutputFormat.Detailed
        except Exception:
            logger.warning("Could not enable detailed Azure STT results.")
        try:
            if self.noise_mode:
                self.speech_config.set_property(
                    speechsdk.PropertyId.SpeechServiceConnection_InitialSilenceTimeoutMs,
                    os.getenv("AZURE_STT_INITIAL_SILENCE_MS", "15000"),
                )
                self.speech_config.set_property(
                    speechsdk.PropertyId.SpeechServiceConnection_EndSilenceTimeoutMs,
                    os.getenv("AZURE_STT_END_SILENCE_MS", "900"),
                )
                segmentation_id = getattr(
                    speechsdk.PropertyId,
                    "Speech_SegmentationSilenceTimeoutMs",
                    None,
                )
                if segmentation_id is not None:
                    self.speech_config.set_property(
                        segmentation_id,
                        os.getenv("AZURE_STT_SEGMENTATION_SILENCE_MS", "900"),
                    )
        except Exception:
            logger.warning("Could not apply optional Azure STT silence timeout settings.")

        self.push_stream = speechsdk.audio.PushAudioInputStream(stream_format=self.audio_format)
        self.audio_config = speechsdk.audio.AudioConfig(stream=self.push_stream)
        self.recognizer = speechsdk.SpeechRecognizer(speech_config=self.speech_config, audio_config=self.audio_config)
        self.recognizer.recognized.connect(self._on_recognized)
        self.recognizer.canceled.connect(self._on_canceled)

    def _set_stt_language(self, language: str):
        if not _is_valid_locale(language):
            return
        if self._recognition_started:
            logger.warning("Ignoring STT language change after recognition has started.")
            return
        self.stt_language = language
        self._build_stt_pipeline(language)

    async def handle_websocket(self, websocket):
        self.websocket = websocket
        self._is_active = True
        self._runtime.start_listening()
        logger.info("Starting WebSocket loop")

        # Get baseline from query params (passed from twilio_voice_handler in bot_main.py)
        # We need to adapt the websocket object or check if it has query_params
        # Since this is an adapter, we check if it has the attribute
        query_client_id = getattr(websocket, "query_params", {}).get("client_id")
        query_industry = getattr(websocket, "query_params", {}).get("industry")
        query_test_workflow = getattr(websocket, "query_params", {}).get("test_workflow")
        query_test_mode = getattr(websocket, "query_params", {}).get("test_mode")

        try:
            async for message in websocket.iter_text():
                data = json.loads(message)
                event_type = data.get("event")
                
                if event_type == "start":
                    self.stream_sid = data["start"]["streamSid"]
                    call_sid = data["start"].get("callSid")
                    self._no_response_reprompts = 0
                    self._last_user_speech_at = time.monotonic()
                    self._last_prompt_at = 0.0
                    self._cancel_no_response_task()
                    
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
                    called_number = custom_params.get("called_number")
                    client_id = custom_params.get("client_id") or query_client_id
                    industry = custom_params.get("industry") or query_industry
                    test_workflow = custom_params.get("test_workflow") or query_test_workflow
                    test_mode = custom_params.get("test_mode") or query_test_mode
                    
                    if from_number:
                         # Strip 'client:' prefix if testing from browser
                         if from_number.startswith("client:"):
                             from_number = from_number.replace("client:", "")
                    self._emit_sim_events = str(test_mode or "").lower() in ("1", "true", "yes")

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
                    if called_number:
                        session["called_number"] = called_number
                    if client_id:
                        session["client_id"] = client_id
                    if industry:
                        session["industry"] = industry
                    if test_mode:
                        session["test_mode"] = str(test_mode)

                    # Load config for this client (used for caller memory + voice)
                    config = None
                    if client_id and industry:
                        from shared_code.utils.config_loader import load_merged_config
                        try:
                            config = load_merged_config(client_id, industry)
                            self._client_config = config
                            tts_provider = config.get("tts_provider") or config.get("voice_provider")
                            if tts_provider:
                                self.tts_provider = tts_provider.strip().lower()
                                logger.info(f"Using TTS provider for client {client_id}: {self.tts_provider}")

                            azure_voice_name = config.get("azure_voice_name") or config.get("voice_name")
                            if azure_voice_name:
                                self.azure_voice_name = azure_voice_name
                                logger.info(f"Using Azure voice for client {client_id}: {self.azure_voice_name}")

                            azure_region = str(config.get("azure_speech_region") or "").strip()
                            if azure_region:
                                if _is_valid_azure_region(azure_region):
                                    self.azure_speech_region = azure_region
                                    logger.info(f"Using Azure speech region for client {client_id}: {self.azure_speech_region}")
                                else:
                                    logger.warning(
                                        f"Invalid azure_speech_region '{azure_region}' for client {client_id}; "
                                        f"falling back to default region '{self.speech_region}'."
                                    )
                                    self.azure_speech_region = self.speech_region

                            azure_lang = config.get("azure_ssml_lang")
                            if _is_valid_locale(azure_lang):
                                self.azure_ssml_lang = azure_lang

                            stt_language = (
                                config.get("stt_language")
                                or config.get("speech_recognition_language")
                                or config.get("language")
                            )
                            if _is_valid_locale(stt_language):
                                self._set_stt_language(stt_language)
                                if not _is_valid_locale(azure_lang):
                                    self.azure_ssml_lang = self.stt_language
                                logger.info(f"Using STT language for client {client_id}: {self.stt_language}")
                            # Optional per-client noise hardening toggles.
                            if "stt_noise_mode" in config:
                                self.noise_mode = _to_bool(config.get("stt_noise_mode"))
                            if config.get("stt_min_confidence") not in (None, ""):
                                try:
                                    self.min_stt_confidence = float(config.get("stt_min_confidence"))
                                except Exception:
                                    pass
                            if config.get("stt_echo_guard_ms") not in (None, ""):
                                try:
                                    self._echo_guard_ms = int(config.get("stt_echo_guard_ms"))
                                except Exception:
                                    pass
                            custom_clarify = config.get("prompts", {}).get("stt_clarify")
                            if isinstance(custom_clarify, str) and custom_clarify.strip():
                                self._clarify_prompt = custom_clarify.strip()
                            phrase_hints = config.get("stt_phrase_hints")
                            if isinstance(phrase_hints, list) and phrase_hints:
                                try:
                                    grammar = speechsdk.PhraseListGrammar.from_recognizer(self.recognizer)
                                    for phrase in phrase_hints[:100]:
                                        phrase_text = str(phrase or "").strip()
                                        if phrase_text:
                                            grammar.addPhrase(phrase_text)
                                    set_weight = getattr(grammar, "setWeight", None)
                                    if callable(set_weight):
                                        set_weight(float(config.get("stt_phrase_weight") or 1.35))
                                except Exception:
                                    logger.warning("Failed to apply STT phrase hints.")

                            azure_style = config.get("azure_voice_style")
                            if azure_style:
                                self.azure_voice_style = azure_style

                            azure_style_degree = config.get("azure_voice_style_degree")
                            if azure_style_degree is not None and azure_style_degree != "":
                                self.azure_voice_style_degree = str(azure_style_degree)

                            client_voice_id = config.get("elevenlabs_voice_id")
                            if client_voice_id:
                                logger.info(f"Overriding VoiceID for client {client_id}: {client_voice_id}")
                                self.voice_id = client_voice_id
                            self.elevenlabs_model_id = str(
                                config.get("elevenlabs_model_id") or self.elevenlabs_model_id
                            )
                            for setting in ("stability", "similarity_boost", "style"):
                                configured = config.get(f"elevenlabs_{setting}")
                                if configured not in (None, ""):
                                    self.elevenlabs_voice_settings[setting] = float(configured)
                        except Exception as e:
                            logger.error(f"Failed to load client config for voice override: {e}")

                    # Optional test workflow override for outbound test calls.
                    # This forces the call to begin in the selected workflow.
                    if test_workflow and config:
                        workflow_key = str(test_workflow).strip()
                        if config.get("workflows", {}).get(workflow_key):
                            session["intent"] = workflow_key
                            session["current_node_id"] = None
                            session.pop("customer_name", None)
                            session.pop("_name_retry", None)
                            logger.info(f"Test workflow override active: intent={workflow_key}")
                        else:
                            logger.warning(
                                f"Test workflow override '{workflow_key}' not found for client={client_id}, industry={industry}"
                            )

                    # Barge-in requires both a short playback grace period and
                    # sustained caller energy. A value of 0 explicitly disables it.
                    try:
                        threshold = (config or {}).get("barge_in_threshold_ms")
                        if threshold is None:
                            threshold = os.getenv("BARGE_IN_GRACE_MS", str(self._barge_in_threshold_ms))
                        self._barge_in_threshold_ms = max(0, int(threshold))
                        self._barge_in_enabled = self._barge_in_threshold_ms > 0
                        self._activity_detector = AudioActivityDetector(
                            rms_threshold=int((config or {}).get("barge_in_rms_threshold") or os.getenv("BARGE_IN_RMS_THRESHOLD", "500")),
                            min_speech_ms=int((config or {}).get("barge_in_min_speech_ms") or os.getenv("BARGE_IN_MIN_SPEECH_MS", "240")),
                            release_ms=int((config or {}).get("barge_in_release_ms") or os.getenv("BARGE_IN_RELEASE_MS", "180")),
                        )
                    except Exception:
                        logger.warning("Invalid barge-in configuration; using environment defaults.")

                    # Caller memory (persistent by phone number)
                    enable_caller_memory = bool((config or {}).get("enable_caller_memory", False))
                    if enable_caller_memory and from_number:
                        try:
                            from shared_code.utils.caller_memory import load_caller_memory, build_memory_note
                            memory = load_caller_memory(from_number)
                            if memory:
                                session["caller_memory"] = build_memory_note(memory)
                                if memory.get("name") and not session.get("customer_name"):
                                    session["customer_name"] = memory.get("name")
                        except Exception as e:
                            logger.warning(f"Failed to load caller memory: {e}")
                    elif not enable_caller_memory:
                        session.pop("caller_memory", None)
                        # Ensure we don't greet with a stale remembered name
                        session.pop("customer_name", None)
                        
                    save_session(self.session_id, session)
                    logger.info(
                        f"Captured Session Context: Phone={from_number}, Client={client_id}, "
                        f"Industry={industry}, TestWorkflow={test_workflow}, STTLang={self.stt_language}, "
                        f"NoiseMode={self.noise_mode}, MinConf={self.min_stt_confidence}"
                    )

                    if self._emit_sim_events and self.websocket:
                        try:
                            await self.websocket.send_text(json.dumps({
                                "event": "sim_state",
                                "kind": "session_start",
                                "intent": session.get("intent"),
                                "current_node_id": session.get("current_node_id"),
                                "client_id": session.get("client_id"),
                                "industry": session.get("industry"),
                                "test_workflow": test_workflow or ""
                            }))
                        except Exception:
                            pass
                    append_call_trace({
                        "event": "session_start",
                        "session_id": self.session_id,
                        "stream_sid": self.stream_sid,
                        "phone_number": from_number,
                        "called_number": called_number,
                        "client_id": session.get("client_id"),
                        "industry": session.get("industry"),
                        "intent": session.get("intent"),
                        "current_node_id": session.get("current_node_id"),
                        "test_mode": bool(self._emit_sim_events),
                        "test_workflow": test_workflow or "",
                    })

                    # Start STT only after client config has been applied. Starting
                    # earlier locks the recognizer to the default language.
                    self._start_recognition()

                    # Warm Azure TTS cache for common prompts to reduce latency
                    if self.tts_provider in ("azure", "azure_neural", "azure_tts"):
                        try:
                            asyncio.create_task(self._warm_tts_cache())
                        except Exception as e:
                            logger.warning(f"Failed to warm TTS cache: {e}")

                    # Initial greeting 
                    # CRITICAL: Do NOT block the loop here.
                    asyncio.create_task(self._process_text("__start__"))
                    
                elif event_type == "media":
                    if not self._recognition_started:
                        self._start_recognition()
                    payload = data["media"]["payload"]
                    chunk = base64.b64decode(payload)
                    # Payload is MULAW 8000Hz. Azure PushStream configured for PCM 16-bit 8000Hz.
                    # Convert MULAW -> PCM
                    pcm_chunk = audioop.ulaw2lin(chunk, 2)
                    self.push_stream.write(pcm_chunk)
                    self._received_media_frames += 1
                    if self._received_media_frames == 1:
                        logger.info("Received first caller audio frame: %d bytes", len(chunk))

                    # Twilio sends media frames continuously, including silence.
                    # Only sustained caller energy is allowed to interrupt playback.
                    caller_started_speaking = self._activity_detector.observe(pcm_chunk)
                    if caller_started_speaking:
                        await self._send_sim_event("speech_detected")
                    if (
                        caller_started_speaking
                        and self._speaking
                        and self._barge_in_enabled
                        and not self._barge_in_triggered
                    ):
                        elapsed_ms = (time.monotonic() - self._speaking_started_at) * 1000.0
                        if elapsed_ms >= self._barge_in_threshold_ms:
                            self._barge_in_triggered = True
                            self._runtime.interrupt()
                            logger.info(f"Sustained caller speech triggered barge-in after {elapsed_ms:.0f}ms.")
                            await self._send_clear_to_twilio()

                elif event_type == "mark":
                    mark_name = str((data.get("mark") or {}).get("name") or "")
                    self._complete_mark(mark_name)

                elif event_type == "dtmf":
                    digit = None
                    try:
                        digit = str((data.get("dtmf") or {}).get("digit") or "").strip()
                    except Exception:
                        digit = ""
                    if digit:
                        logger.info(f"Received DTMF digit: {digit}")
                        if hasattr(self, 'loop'):
                            asyncio.run_coroutine_threadsafe(self._process_text(f"dtmf:{digit}"), self.loop)
                    
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
            self._runtime.close()
            if self._transcript_task and not self._transcript_task.done():
                self._transcript_task.cancel()
            self._cancel_no_response_task()
            self._stop_recognition()
            for future in self._pending_marks.values():
                if not future.done():
                    future.cancel()
            self._pending_marks.clear()

    def _on_recognized(self, evt):
        if not self._is_active:
            logger.info("Ignoring final STT result after the stream stopped.")
            return
        if evt.result.reason == speechsdk.ResultReason.RecognizedSpeech:
            text = evt.result.text
            if text:
                confidence = self._extract_confidence(evt.result)
                if confidence is not None:
                    logger.info(f"User said: {text} (confidence={confidence:.2f})")
                else:
                    logger.info(f"User said: {text}")
                if self._emit_sim_events and hasattr(self, "loop"):
                    asyncio.run_coroutine_threadsafe(
                        self._send_sim_event("transcript", text=text, confidence=confidence),
                        self.loop,
                    )
                self._last_user_speech_at = time.monotonic()
                self._no_response_reprompts = 0
                self._cancel_no_response_task()
                if (
                    (self._speaking and not self._barge_in_triggered)
                    or not self._runtime.may_accept_transcript(self._barge_in_triggered)
                ):
                    logger.info("Ignoring STT while conversation phase is %s.", self._runtime.phase.value)
                    return
                if self._duplicate_guard.is_duplicate(text):
                    logger.info("Ignoring duplicate final STT result: %r", text)
                    return
                if hasattr(self, 'loop'):
                    asyncio.run_coroutine_threadsafe(
                        self._queue_stable_transcript(text, confidence), self.loop
                    )

    async def _queue_stable_transcript(self, text: str, confidence: Optional[float]):
        """Coalesce adjacent Azure final segments before advancing a workflow."""
        cleaned = str(text or "").strip()
        if not cleaned or not self._is_active:
            return
        self._pending_transcript = " ".join(
            part for part in (self._pending_transcript, cleaned) if part
        ).strip()
        if confidence is not None:
            self._pending_confidence = max(
                confidence,
                self._pending_confidence if self._pending_confidence is not None else confidence,
            )
        if self._transcript_task and not self._transcript_task.done():
            self._transcript_task.cancel()

        async def _commit():
            try:
                await asyncio.sleep(max(0.0, self._transcript_settle_s))
                utterance = self._pending_transcript
                utterance_confidence = self._pending_confidence
                self._pending_transcript = ""
                self._pending_confidence = None
                if utterance and self._is_active:
                    await self._process_text(utterance, confidence=utterance_confidence)
            except asyncio.CancelledError:
                return

        self._transcript_task = asyncio.create_task(_commit())

    def _on_canceled(self, evt):
        logger.warning(f"Speech canceled: {evt}")

    def _extract_confidence(self, result) -> Optional[float]:
        try:
            raw = result.properties.get(speechsdk.PropertyId.SpeechServiceResponse_JsonResult)
            if not raw:
                return None
            parsed = json.loads(raw)
            nbest = parsed.get("NBest") or []
            if not nbest:
                return None
            conf = nbest[0].get("Confidence")
            return float(conf) if conf is not None else None
        except Exception:
            return None

    def _is_likely_noise(self, text: str, confidence: Optional[float]) -> bool:
        cleaned = re.sub(r"[^A-Za-z0-9\s]", " ", str(text or "")).strip().lower()
        if not cleaned:
            return True
        tokens = [t for t in cleaned.split() if t]
        if self._expecting_name and len(tokens) == 1 and re.fullmatch(r"[a-z][a-z' -]{1,30}", tokens[0]):
            # Short names score lower than sentences, but extremely weak guesses
            # such as 0.06 must not advance the workflow.
            return confidence is not None and confidence < self.min_name_confidence
        if confidence is not None and confidence < self.min_stt_confidence:
            return True
        if not tokens:
            return True
        if len(tokens) == 1 and tokens[0] in {"uh", "um", "erm", "hmm", "mm", "mmm"}:
            return True
        if len(cleaned) <= 1:
            return True
        return False

    async def _reprompt_for_noise(self):
        if hasattr(self, "_hanging_up") and self._hanging_up:
            return
        await self._speak_prompt(self._clarify_prompt)
        # Let callers answer quickly after a noise clarify prompt.
        self._post_tts_guard_until = time.monotonic() + 0.2
        # Ensure we never go silent if STT misses the immediate retry.
        self._schedule_no_response_reprompt()

    def _cancel_no_response_task(self):
        task = self._no_response_task
        if task and not task.done():
            task.cancel()
        self._no_response_task = None

    def _schedule_no_response_reprompt(self):
        self._cancel_no_response_task()
        if self._no_response_timeout_s <= 0:
            return

        async def _watchdog():
            try:
                await asyncio.sleep(self._no_response_timeout_s)
                if not self._is_active or (hasattr(self, "_hanging_up") and self._hanging_up):
                    return
                if self._speaking:
                    return
                if self._no_response_reprompts >= self._no_response_reprompt_max:
                    return
                if self._last_user_speech_at >= self._last_prompt_at:
                    return
                self._no_response_reprompts += 1
                await self._speak_prompt("Sorry, I didn't catch that. Could you repeat that?")
                self._schedule_no_response_reprompt()
            except asyncio.CancelledError:
                return
            except Exception as e:
                logger.warning(f"No-response watchdog failed: {e}")

        self._no_response_task = asyncio.create_task(_watchdog())

    async def _speak_prompt(self, prompt: str, token: Optional[TurnToken] = None):
        if hasattr(self, "_hanging_up") and self._hanging_up:
            return
        if token and not self._runtime.begin_speaking(token):
            logger.info("Discarding speech for stale turn %s.", token.generation)
            return
        self._barge_in_triggered = False
        self._activity_detector.reset()
        self._speaking = True
        self._speaking_started_at = time.monotonic()
        try:
            if self.tts_provider in ("azure", "azure_neural", "azure_tts"):
                used = await self._stream_azure_tts(prompt)
                if not used:
                    await self._stream_elevenlabs_tts_optimized(prompt)
            else:
                used = await self._stream_elevenlabs_tts_optimized(prompt)
                if not used:
                    await self._stream_azure_tts(prompt)
            if not self._barge_in_triggered:
                await self._wait_for_playback_complete()
        finally:
            self._speaking = False
            self._activity_detector.reset()
            self._last_prompt_at = time.monotonic()
            self._post_tts_guard_until = time.monotonic() + (max(self._echo_guard_ms, 0) / 1000.0)
            if token:
                self._runtime.finish_turn(token)

    async def _process_text(self, text, confidence: Optional[float] = None):
        if hasattr(self, "_hanging_up") and self._hanging_up:
            logger.info("Ignoring text input because call is hanging up.")
            return
        async with self._turn_lock:
            await self._process_text_locked(text, confidence)

    async def _process_text_locked(self, text, confidence: Optional[float] = None):
        if hasattr(self, "_hanging_up") and self._hanging_up:
            logger.info("Ignoring text input because call is hanging up.")
            return
        if text != "__start__" and self.noise_mode:
            if time.monotonic() < self._post_tts_guard_until:
                logger.info("Ignoring STT during post-TTS echo guard window.")
                return
            if self._is_likely_noise(text, confidence):
                logger.info("High-noise mode: asking caller to repeat.")
                await self._reprompt_for_noise()
                return

        try:
            turn_token = self._runtime.begin_turn(str(text or ""))
        except RuntimeError:
            logger.info("Ignoring input because the conversation runtime is ending.")
            return

        # 1. Get Agent Response
        logger.info(f"Processing text: {text} | Session: {self.session_id}")
        prev_intent = None
        prev_node_id = None
        try:
            from shared_code.utils.session import load_session
            prev_session = load_session(self.session_id) or {}
            prev_intent = prev_session.get("intent")
            prev_node_id = prev_session.get("current_node_id")
        except Exception:
            prev_intent = None
            prev_node_id = None
        started_at = time.time()
        try:
            response = await self._run_agent_with_progress(text)
        except Exception as e:
            import traceback
            logger.error(f"CRITICAL AGENT ERROR: {e}\n{traceback.format_exc()}")
            append_call_trace({
                "event": "turn_error",
                "session_id": self.session_id,
                "stream_sid": self.stream_sid,
                "client_id": None,
                "industry": None,
                "input_text": text,
                "error": str(e),
                "latency_ms": int((time.time() - started_at) * 1000),
            })
            self._runtime.finish_turn(turn_token)
            return

        if not self._runtime.is_current(turn_token):
            logger.info("Discarding completed work for stale turn %s.", turn_token.generation)
            return

        reply_text = response.get("prompt")
        if isinstance(reply_text, str):
            reply_text = reply_text.strip()
        if not reply_text:
            logger.warning(
                "Agent returned empty prompt (session=%s, text=%r). Sending fallback prompt.",
                self.session_id,
                text,
            )
            reply_text = "Sorry, I didn't catch that. Could you repeat that for me?"

        if self._emit_sim_events and self.websocket:
            try:
                next_session = response.get("session") if isinstance(response, dict) else None
                next_intent = (next_session or {}).get("intent")
                current_node_id = (next_session or {}).get("current_node_id")
                event_kind = "workflow_handoff" if next_intent and prev_intent and next_intent != prev_intent else "turn"
                await self.websocket.send_text(json.dumps({
                    "event": "sim_state",
                    "kind": event_kind,
                    "previous_intent": prev_intent,
                    "intent": next_intent,
                    "current_node_id": current_node_id
                }))
            except Exception:
                pass

        next_session = response.get("session") if isinstance(response, dict) else {}
        next_intent = (next_session or {}).get("intent")
        next_node_id = (next_session or {}).get("current_node_id")
        append_call_trace({
            "event": "turn",
            "session_id": self.session_id,
            "stream_sid": self.stream_sid,
            "client_id": (next_session or {}).get("client_id"),
            "industry": (next_session or {}).get("industry"),
            "input_text": text,
            "output_text": reply_text,
            "previous_intent": prev_intent,
            "intent": next_intent,
            "previous_node_id": prev_node_id,
            "current_node_id": next_node_id,
            "handoff": bool(next_intent and prev_intent and next_intent != prev_intent),
            "latency_ms": int((time.time() - started_at) * 1000),
            "test_mode": bool(self._emit_sim_events),
            "turn_generation": turn_token.generation,
            "conversation_phase": self._runtime.phase.value,
        })
        
        # Check for Hangup Signal
        should_hangup = False
        if reply_text and "[HANGUP]" in reply_text:
            reply_text = reply_text.replace("[HANGUP]", "").strip()
            should_hangup = True
            logger.info("Hangup signal detected. Ending after final prompt.")

        if reply_text:
            lower_reply = reply_text.lower()
            self._expecting_name = (
                "take your name" in lower_reply
                or "catch your name" in lower_reply
                or ("your name" in lower_reply and "repeat" in lower_reply)
            )
        
        if reply_text:
            logger.info(f"Agent reply: {reply_text}")
            # 2. Convert to Speech
            await self._speak_prompt(reply_text, turn_token)
            self._schedule_no_response_reprompt()
            
        if should_hangup:
            self._hanging_up = True
            self._runtime.begin_ending()
            logger.info("Closing socket due to HANGUP signal.")
            # Give a small delay for audio to flush
            await asyncio.sleep(8)
            if self.websocket:
                await self.websocket.close()

    async def _run_agent_with_progress(self, text: str):
        work = asyncio.create_task(asyncio.to_thread(run_agent_step, self.session_id, text))
        progress = None
        if text != "__start__" and not self._expecting_name and self._progress_delay_s > 0:
            progress = asyncio.create_task(self._delayed_progress_feedback(work))
        try:
            return await work
        finally:
            if progress:
                progress.cancel()
                try:
                    await progress
                except asyncio.CancelledError:
                    pass
                if self._progress_active:
                    await self._send_clear_to_twilio()
                    self._progress_active = False

    async def _delayed_progress_feedback(self, work: asyncio.Task):
        await asyncio.sleep(self._progress_delay_s)
        if work.done() or not self._is_active:
            return
        self._progress_active = True
        phrases = (
            "Let me just check that for you.",
            "One moment while I look into that.",
            "I'll quickly check that now.",
        )
        phrase = phrases[self._progress_index % len(phrases)]
        self._progress_index += 1
        await self._speak_prompt(phrase)
        if not self._progress_typing_enabled:
            return
        typing_audio = base64.b64encode(build_typing_ulaw()).decode("ascii")
        while not work.done() and self._is_active:
            await self._send_media_to_twilio(typing_audio)
            await asyncio.sleep(0.95)

    async def _stream_elevenlabs_tts_optimized(self, text):
        # Better implementation: use output_format=ulaw_8000 directly
        url = (
            f"wss://api.elevenlabs.io/v1/text-to-speech/{self.voice_id}/stream-input"
            f"?model_id={self.elevenlabs_model_id}&output_format=ulaw_8000&auto_mode=true"
        )
        
        header = {
            "xi-api-key": self.elevenlabs_api_key or os.getenv("ELEVENLABS_API_KEY")
        }
        
        try:
            sent_audio = False
            async with websockets.connect(url, extra_headers=header) as ws:
                await ws.send(json.dumps({
                    "text": " ",
                    "voice_settings": self.elevenlabs_voice_settings,
                }))
                await ws.send(json.dumps({"text": f"{text} ", "flush": True}))
                await ws.send(json.dumps({"text": ""})) # EOS

                async for message in ws:
                    data = json.loads(message)
                    audio_b64 = data.get("audio")
                    
                    if audio_b64:
                        if self._barge_in_triggered:
                            break
                        # Direct u-law chunks from ElevenLabs
                        await self._send_media_to_twilio(audio_b64)
                        sent_audio = True
                        
                    if data.get("isFinal"):
                        break
            return sent_audio
        except Exception as e:
            logger.error(f"ElevenLabs TTS Error: {e}")
            return False

    async def _stream_azure_tts(self, text, send_audio: bool = True):
        speech_region = self.azure_speech_region or self.speech_region
        speech_key = self.speech_key
        hd_region = os.getenv("AZURE_SPEECH_REGION_HD")
        hd_key = os.getenv("AZURE_SPEECH_KEY_HD")
        if hd_region and hd_key and speech_region and speech_region.lower() == hd_region.lower():
            speech_key = hd_key

        if not speech_key or not speech_region:
            logger.error("Azure TTS requested but AZURE_SPEECH_KEY or AZURE_SPEECH_REGION is missing.")
            return False

        voice_name = self.azure_voice_name or os.getenv("AZURE_SPEECH_VOICE") or "en-GB-LibbyNeural"
        lang = (self.azure_ssml_lang or "en-GB").strip() or "en-GB"
        style = (self.azure_voice_style or "").strip()
        style_degree = (self.azure_voice_style_degree or "").strip() if self.azure_voice_style_degree is not None else ""

        try:
            cache_key = (speech_region, voice_name, lang, style, style_degree, text)
            cached = self._tts_cache.get(cache_key)
            if cached:
                if send_audio:
                    for chunk in cached:
                        await self._send_media_to_twilio(chunk)
                return True

            speech_config = speechsdk.SpeechConfig(subscription=speech_key, region=speech_region)
            speech_config.speech_synthesis_voice_name = voice_name

            output_format = getattr(speechsdk.SpeechSynthesisOutputFormat, "Raw8Khz8BitMonoMULaw", None)
            if output_format is None:
                output_format = getattr(speechsdk.SpeechSynthesisOutputFormat, "Riff8Khz8BitMonoMULaw", None)
            if output_format is None:
                logger.error("Azure TTS output format for 8kHz mu-law not available in SDK.")
                return False

            speech_config.set_speech_synthesis_output_format(output_format)
            synthesizer = speechsdk.SpeechSynthesizer(speech_config=speech_config, audio_config=None)

            loop = asyncio.get_event_loop()
            ssml = self._build_azure_ssml(text=text, voice_name=voice_name, lang=lang, style=style, style_degree=style_degree)
            result = await loop.run_in_executor(None, lambda: synthesizer.speak_ssml_async(ssml).get())

            # Some voices don't support certain styles; retry once without style.
            if result.reason == speechsdk.ResultReason.Canceled and style:
                retry_ssml = self._build_azure_ssml(text=text, voice_name=voice_name, lang=lang, style="", style_degree="")
                result = await loop.run_in_executor(None, lambda: synthesizer.speak_ssml_async(retry_ssml).get())

            if result.reason == speechsdk.ResultReason.SynthesizingAudioCompleted:
                audio = result.audio_data
                if audio[:4] == b"RIFF" and len(audio) > 44:
                    # Strip RIFF header if present
                    audio = audio[44:]

                chunk_size = 160  # 20ms @ 8kHz mu-law
                cached_chunks = []
                for i in range(0, len(audio), chunk_size):
                    chunk = audio[i:i + chunk_size]
                    if not chunk:
                        continue
                    if self._barge_in_triggered:
                        break
                    b64_audio = base64.b64encode(chunk).decode("utf-8")
                    cached_chunks.append(b64_audio)
                    if send_audio:
                        await self._send_media_to_twilio(b64_audio)
                # Cache for future use (common prompts)
                self._tts_cache[cache_key] = cached_chunks
                if len(self._tts_cache) > self._tts_cache_limit:
                    self._tts_cache.pop(next(iter(self._tts_cache)))
                return True

            if result.reason == speechsdk.ResultReason.Canceled:
                cancellation_details = result.cancellation_details
                logger.error(f"Azure TTS canceled: {cancellation_details.reason} | {cancellation_details.error_details}")
                return False

            logger.error(f"Azure TTS failed. Reason: {result.reason}")
            return False
        except Exception as e:
            logger.error(f"Azure TTS Error: {e}")
            return False

    @staticmethod
    def _xml_escape(value: str) -> str:
        return (
            str(value)
            .replace("&", "&amp;")
            .replace("<", "&lt;")
            .replace(">", "&gt;")
            .replace('"', "&quot;")
            .replace("'", "&apos;")
        )

    def _build_azure_ssml(self, text: str, voice_name: str, lang: str, style: str = "", style_degree: str = "") -> str:
        escaped_text = self._xml_escape(text)
        escaped_voice = self._xml_escape(voice_name)
        escaped_lang = self._xml_escape(lang or "en-GB")
        escaped_style = self._xml_escape(style)
        escaped_style_degree = self._xml_escape(style_degree)

        if escaped_style:
            style_part = f'<mstts:express-as style="{escaped_style}"'
            if escaped_style_degree:
                style_part += f' styledegree="{escaped_style_degree}"'
            style_part += f'><lang xml:lang="{escaped_lang}">{escaped_text}</lang></mstts:express-as>'
        else:
            style_part = f'<lang xml:lang="{escaped_lang}">{escaped_text}</lang>'

        return (
            f'<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" '
            f'xmlns:mstts="http://www.w3.org/2001/mstts" xml:lang="{escaped_lang}">'
            f'<voice name="{escaped_voice}">{style_part}</voice></speak>'
        )

    def _resolve_prompt_vars(self, prompt: str) -> str:
        if not prompt:
            return ""
        assistant = ""
        brand = ""
        if isinstance(self._client_config, dict):
            assistant = (
                self._client_config.get("assistant_name")
                or self._client_config.get("agent_name")
                or "agent"
            )
            brand = (
                self._client_config.get("brand_name")
                or self._client_config.get("default_brand_name")
                or "brand"
            )
        text = prompt.replace("{assistant}", str(assistant)).replace("{brand}", str(brand))
        text = text.replace("{name}", "")
        # Clean up punctuation/spacing if name is missing
        import re
        text = re.sub(r",\s*([?.!])", r"\1", text)
        text = re.sub(r"\s{2,}", " ", text).strip()
        return text

    async def _warm_tts_cache(self):
        if not self._client_config:
            return
        prompts = self._client_config.get("prompts", {})
        if not isinstance(prompts, dict):
            return
        keys = ["system_greeting", "ask_intent_with_name", "ask_intent_retry_giveup"]
        texts = []
        for k in keys:
            if k in prompts:
                resolved = self._resolve_prompt_vars(prompts.get(k))
                if resolved:
                    texts.append(resolved)
        # Avoid warming too many prompts
        for text in texts[:3]:
            await self._stream_azure_tts(text, send_audio=False)

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

    async def _send_sim_event(self, kind: str, **payload):
        if not self._emit_sim_events or not self.websocket:
            return
        try:
            await self.websocket.send_text(json.dumps({"event": "sim_state", "kind": kind, **payload}))
        except Exception:
            pass

    async def _wait_for_playback_complete(self):
        # Browser simulation does not implement Twilio mark acknowledgements.
        if self._emit_sim_events or not self.websocket or not self.stream_sid:
            return
        self._mark_counter += 1
        mark_name = f"assistant-{self._mark_counter}"
        future = asyncio.get_running_loop().create_future()
        self._pending_marks[mark_name] = future
        message = {
            "event": "mark",
            "streamSid": self.stream_sid,
            "mark": {"name": mark_name},
        }
        try:
            await self.websocket.send_text(json.dumps(message))
            await asyncio.wait_for(future, timeout=30)
        except asyncio.TimeoutError:
            logger.warning("Timed out waiting for Twilio playback mark %s", mark_name)
        except Exception as e:
            logger.warning("Failed while waiting for Twilio playback mark %s: %s", mark_name, e)
        finally:
            self._pending_marks.pop(mark_name, None)

    def _complete_mark(self, mark_name: str):
        future = self._pending_marks.get(mark_name)
        if future and not future.done():
            future.set_result(True)

    async def _send_clear_to_twilio(self):
        if self.websocket and self.stream_sid:
            msg = {
                "event": "clear",
                "streamSid": self.stream_sid
            }
            try:
                await self.websocket.send_text(json.dumps(msg))
            except Exception as e:
                logger.warning(f"Failed to send clear to Twilio: {e}")

    # Add loop setter for thread safety bridge
    def set_loop(self, loop):
        self.loop = loop
