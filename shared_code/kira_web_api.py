"""Authenticated browser-voice adapter for the Corempower Kira experience."""

import asyncio
import audioop
import hmac
import json
import os
import re
import tempfile
import urllib.parse
import urllib.request
import wave

from aiohttp import web
import azure.cognitiveservices.speech as speechsdk


MAX_AUDIO_BYTES = 10 * 1024 * 1024
MAX_TEXT_LENGTH = 2000


def _authorized(request):
    expected = os.getenv("COREMPOWER_VOICE_API_KEY", "")
    supplied = request.headers.get("Authorization", "")
    if supplied.lower().startswith("bearer "):
        supplied = supplied[7:].strip()
    return bool(expected) and hmac.compare_digest(expected, supplied)


def _speech_settings():
    key = os.getenv("AZURE_SPEECH_KEY") or os.getenv("SPEECH_KEY")
    region = os.getenv("AZURE_SPEECH_REGION") or os.getenv("SPEECH_REGION")
    if not key or not region:
        raise RuntimeError("Azure Speech is not configured")
    return key, region


def _normalize_wav_for_speech(source_path):
    """Convert browser WAV input to the 16 kHz mono PCM expected by Speech."""
    with wave.open(source_path, "rb") as source:
        channels = source.getnchannels()
        sample_width = source.getsampwidth()
        sample_rate = source.getframerate()
        frames = source.readframes(source.getnframes())
    if channels == 2:
        frames = audioop.tomono(frames, sample_width, 0.5, 0.5)
    elif channels != 1:
        raise ValueError("Only mono or stereo PCM WAV audio is supported")
    if sample_width != 2:
        frames = audioop.lin2lin(frames, sample_width, 2)
    if sample_rate != 16000:
        frames, _ = audioop.ratecv(frames, 2, 1, sample_rate, 16000, None)
    output = source_path + ".speech.wav"
    with wave.open(output, "wb") as target:
        target.setnchannels(1)
        target.setsampwidth(2)
        target.setframerate(16000)
        target.writeframes(frames)
    return output


async def transcribe(request):
    if not _authorized(request):
        raise web.HTTPUnauthorized()
    audio = await request.read()
    if not audio or len(audio) > MAX_AUDIO_BYTES:
        return web.json_response({"error": "invalid audio size"}, status=400)
    if "audio/wav" not in request.headers.get("Content-Type", "").lower():
        return web.json_response({"error": "PCM WAV audio is required"}, status=415)

    path = None
    normalized_path = None
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=".wav") as handle:
            path = handle.name
            handle.write(audio)
        normalized_path = _normalize_wav_for_speech(path)
        key, region = _speech_settings()

        def recognize():
            language = os.getenv("KIRA_SPEECH_LANGUAGE", "en-GB")
            query = urllib.parse.urlencode({"language": language, "format": "detailed"})
            endpoint = (
                "https://" + region + ".stt.speech.microsoft.com/"
                "speech/recognition/conversation/cognitiveservices/v1?" + query
            )
            with open(normalized_path, "rb") as audio_file:
                request = urllib.request.Request(
                    endpoint,
                    data=audio_file.read(),
                    headers={
                        "Ocp-Apim-Subscription-Key": key,
                        "Content-Type": "audio/wav",
                        "Accept": "application/json",
                    },
                    method="POST",
                )
            with urllib.request.urlopen(request, timeout=20) as response:
                result = json.loads(response.read().decode("utf-8"))
            status = result.get("RecognitionStatus")
            if status == "Success":
                return str(result.get("DisplayText") or "").strip()
            if status in ("NoMatch", "InitialSilenceTimeout"):
                return ""
            raise RuntimeError("Azure Speech recognition failed: " + str(status or "unknown error"))

        text = await asyncio.get_running_loop().run_in_executor(None, recognize)
        return web.json_response({"text": text})
    finally:
        for temporary_path in (normalized_path, path):
            if temporary_path and os.path.exists(temporary_path):
                os.remove(temporary_path)


async def synthesize(request):
    if not _authorized(request):
        raise web.HTTPUnauthorized()
    body = await request.json()
    text = str(body.get("text") or "").strip()
    if not text or len(text) > MAX_TEXT_LENGTH:
        return web.json_response({"error": "invalid text length"}, status=400)
    key, region = _speech_settings()

    def speak():
        config = speechsdk.SpeechConfig(subscription=key, region=region)
        config.speech_synthesis_voice_name = os.getenv("KIRA_SPEECH_VOICE", "en-GB-SoniaNeural")
        config.set_speech_synthesis_output_format(
            speechsdk.SpeechSynthesisOutputFormat.Riff24Khz16BitMonoPcm
        )
        result = speechsdk.SpeechSynthesizer(speech_config=config, audio_config=None).speak_text_async(text).get()
        if result.reason != speechsdk.ResultReason.SynthesizingAudioCompleted:
            details = speechsdk.SpeechSynthesisCancellationDetails(result)
            raise RuntimeError(
                "Azure Speech synthesis was cancelled: "
                + str(details.reason)
                + (" (" + details.error_details + ")" if details.error_details else "")
            )
        return bytes(result.audio_data)

    audio = await asyncio.get_running_loop().run_in_executor(None, speak)
    return web.Response(body=audio, content_type="audio/wav", headers={"Cache-Control": "no-store"})


async def turn(request):
    """Return a Kira orchestration decision; Corempower executes privileged actions."""
    if not _authorized(request):
        raise web.HTTPUnauthorized()
    body = await request.json()
    text = str(body.get("text") or "").strip()
    if len(text) > MAX_TEXT_LENGTH:
        return web.json_response({"error": "invalid text length"}, status=400)

    if not text or text == "__start__":
        return web.json_response({
            "reply": "Hello, I’m Kira, your My Insights guide. Would you like to continue your story, prepare for an appointment, or talk about how you have been feeling?",
            "action": None,
        })
    if re.search(r"continue\s+(my\s+)?story|unfinished\s+(question|story)|next\s+(question|story)", text, re.I):
        return web.json_response({
            "reply": "I’ll check your saved My Story progress now.",
            "action": "continue_story",
        })
    if re.search(r"appointment|psychiatrist|clinician", text, re.I):
        return web.json_response({
            "reply": "I can help you prepare. What is the most important change or concern you want your clinician to understand?",
            "action": "prepare_appointment",
        })
    return web.json_response({
        "reply": "Thank you for sharing that. Would you like to continue your story or prepare something for your clinician?",
        "action": None,
    })


def register_kira_routes(app):
    app.router.add_post("/api/kira/transcribe", transcribe)
    app.router.add_post("/api/kira/synthesize", synthesize)
    app.router.add_post("/api/kira/turn", turn)

