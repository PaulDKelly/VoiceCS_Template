"""
Bot Framework Main Application
Replaces the FastAPI + WebSocket implementation with Bot Framework adapter.
"""
import os
import logging
import json
import asyncio
import base64
from aiohttp import web, WSMsgType
from aiohttp.web import Request, Response
from botbuilder.core import BotFrameworkAdapterSettings, BotFrameworkAdapter
from botbuilder.schema import Activity
from azure.communication.callautomation import (
    CallAutomationClient,
    CallInvite,
    MediaStreamingOptions,
    AudioFormat,
)
from azure.eventgrid import EventGridEvent, SystemEventNames

from bot_adapter import VoiceAgentBot
from realtime_bridge import RealtimeVoiceBridge
from twilio.twiml.voice_response import VoiceResponse, Connect, Stream

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger("voicecs-bot")

try:
    import azure.communication.callautomation as aca
    logger.info(f"Initialized with Call Automation SDK Version: {aca.__version__}")
except Exception:
    logger.info("Could not determine Call Automation SDK version at startup")

print("RUNNING BOT FRAMEWORK VERSION: VOICE-AGENT-BOT")


def resolve_routing(called_number, mappings, client_id, industry):
    mapping_found = False
    candidate_used = None

    normalized_called = called_number
    try:
        import re
        normalized_called = re.sub(r"[\s\-()]", "", called_number or "")
    except Exception:
        normalized_called = called_number

    candidates = [
        normalized_called,
        "+" + normalized_called.lstrip("+"),
        normalized_called.lstrip("+"),
        called_number,
        "+" + called_number.lstrip("+"),
        called_number.lstrip("+"),
    ]

    for candidate in candidates:
        if candidate in mappings:
            client_id = mappings[candidate].get("client_id", client_id)
            industry = mappings[candidate].get("industry", industry)
            mapping_found = True
            candidate_used = candidate
            break

    return client_id, industry, mapping_found, candidate_used, candidates

# ---------------------------------------------------------
# ENV VARS
# ---------------------------------------------------------
MICROSOFT_APP_ID = os.getenv("MICROSOFT_APP_ID")
MICROSOFT_APP_PASSWORD = os.getenv("MICROSOFT_APP_PASSWORD")

if not MICROSOFT_APP_ID or not MICROSOFT_APP_PASSWORD:
    logger.warning("MICROSOFT_APP_ID or MICROSOFT_APP_PASSWORD not set - running in development mode")
    # For local development, these can be empty
    MICROSOFT_APP_ID = MICROSOFT_APP_ID or ""
    MICROSOFT_APP_PASSWORD = MICROSOFT_APP_PASSWORD or ""

# Verify required agent config is present (allow phone-mapping-only routing)
CLIENT_ID = os.getenv("CLIENT_ID")
INDUSTRY = os.getenv("INDUSTRY")

if not CLIENT_ID or not INDUSTRY:
    logger.warning("CLIENT_ID and/or INDUSTRY not set - relying on phone mappings for routing")
else:
    logger.info(f"Bot configured for CLIENT_ID={CLIENT_ID}, INDUSTRY={INDUSTRY}")

# ---------------------------------------------------------
# ACS & VOICE BRIDGE SETUP
# ---------------------------------------------------------
ACS_CONNECTION_STRING = os.getenv("ACS_CONNECTION_STRING")
SPEECH_REGION = os.getenv("SPEECH_REGION")
AOAI_API_KEY = os.getenv("AOAI_API_KEY")
AOAI_ENDPOINT = os.getenv("AOAI_ENDPOINT")
AOAI_MODEL = os.getenv("AOAI_MODEL", "gpt-4o-realtime-preview")

# Public domain for callbacks (must be set in deployment)
CALLBACK_URI_HOST = os.getenv("CALLBACK_URI_HOST") 
# e.g. "https://voicecs-agent.ex.azurecontainerapps.io"

call_automation_client = None
if ACS_CONNECTION_STRING:
    call_automation_client = CallAutomationClient.from_connection_string(ACS_CONNECTION_STRING)
    logger.info("ACS Call Automation Client initialized")
else:
    logger.warning("ACS_CONNECTION_STRING not set - Voice Bridge disabled")



# ---------------------------------------------------------
# BOT FRAMEWORK SETUP
# ---------------------------------------------------------
settings = BotFrameworkAdapterSettings(MICROSOFT_APP_ID, MICROSOFT_APP_PASSWORD)
adapter = BotFrameworkAdapter(settings)

# Error handler
async def on_error(context, error):
    logger.error(f"Bot error: {error}", exc_info=error)
    await context.send_activity("Sorry, something went wrong. Please try again.")

adapter.on_turn_error = on_error

# Create bot instance
bot = VoiceAgentBot()

# Global state for active voice bridges
# Map: call_connection_id -> VoiceBridge instance
active_bridges = {}

# ---------------------------------------------------------
# TWILIO ENDPOINTS
# ---------------------------------------------------------
async def twilio_voice_handler(req: Request) -> Response:
    """
    Handle incoming voice call from Twilio.
    Returns TwiML to connect to the WebSocket bridge.
    """
    logger.info("Twilio voice handler triggered")
    
    # Extract Caller ID and Called Number (To) from Form Data
    try:
        form_data = await req.post()
        caller_number = form_data.get("From", "Unknown")
        called_number = form_data.get("To", "Unknown")
    except Exception:
        caller_number = "Unknown"
        called_number = "Unknown"

    # Use configured public URL if available
    host = os.getenv("PUBLIC_URL") or CALLBACK_URI_HOST
    
    # Fallback to request host if no config
    if not host:
        requested_host = req.headers.get("Host")
        if requested_host:
            host = f"https://{requested_host}"
    
    # Ensure we have a valid host string before replacing
    if host:
        # Handle cases where host might not have scheme
        if "://" not in host:
            host = f"https://{host}"
        ws_url = f"{host.replace('https://', 'wss://').replace('http://', 'ws://')}/api/audio-twilio"
    else:
        # Fallback for very weird cases
        ws_url = "/api/audio-twilio"

    logger.info(f"Generated Twilio WebSocket URL: {ws_url}")
    logger.info(f"Caller ID: {caller_number}, Called Number: {called_number}")

    # Phone Number Routing Logic
    client_id = os.getenv("CLIENT_ID")
    industry = os.getenv("INDUSTRY")
    mapping_found = False
    candidate_used = None

    try:
        from shared_code.utils.config_loader import load_phone_mappings
        mappings = load_phone_mappings()
        
        client_id, industry, mapping_found, candidate_used, candidates = resolve_routing(
            called_number,
            mappings,
            client_id,
            industry,
        )

        if mapping_found:
            logger.info(f"Routing match found for candidate '{candidate_used}'! -> Client: {client_id}")

        if not mapping_found:
            keys = list(mappings.keys())
            sample = keys[:10]
            logger.warning(
                "No routing match for called number '%s'. Candidates tried: %s. Available mappings: %s (total=%d)",
                called_number,
                candidates,
                sample,
                len(keys),
            )
    except Exception as e:
        logger.error(f"Failed to load phone mappings: {e}")

    # If no mapping found, reject unless explicitly allowed
    allow_unmapped = str(os.getenv("ALLOW_UNMAPPED_CALLS", "")).lower() in ("1", "true", "yes")
    if not mapping_found and not allow_unmapped:
        logger.warning(f"Unrecognized number {called_number}. Rejecting (no mapping).")
        response = VoiceResponse()
        response.say("I'm sorry, this phone number is not currently routed. Please contact support for assistance. Goodbye.", voice="Polly.Amy")
        response.hangup()
        return Response(text=str(response), content_type='application/xml')

    # Pass configuration via Query Parameters so WebSocket can access them immediately
    import urllib.parse
    params = urllib.parse.urlencode({
        "client_id": client_id,
        "industry": industry
    })
    ws_url_with_params = f"{ws_url}?{params}"
    
    response = VoiceResponse()
    connect = Connect()
    stream = Stream(url=ws_url_with_params)
    stream.parameter(name="phone_number", value=caller_number)
    stream.parameter(name="called_number", value=called_number)
    stream.parameter(name="client_id", value=client_id)
    stream.parameter(name="industry", value=industry)
    connect.append(stream)
    response.append(connect)

    logger.info(
        "TwiML routing resolved -> client_id=%s, industry=%s, called=%s, caller=%s, candidate_used=%s",
        client_id,
        industry,
        called_number,
        caller_number,
        candidate_used,
    )
    
    return Response(text=str(response), content_type='application/xml')

from shared_code.twilio_bridge import TwilioBridge
from shared_code.utils.config_loader import load_merged_config

class AiohttpWebSocketAdapter:
    """Adapts aiohttp WebSocketResponse to match the interface expected by TwilioBridge (FastAPI-like)."""
    def __init__(self, ws, query_params=None):
        self.ws = ws
        self.query_params = query_params or {}

    async def iter_text(self):
        async for msg in self.ws:
            if msg.type == WSMsgType.TEXT:
                yield msg.data
            elif msg.type == WSMsgType.ERROR:
                break

    async def send_text(self, data: str):
        await self.ws.send_str(data)
        
    async def close(self):
        await self.ws.close()

async def twilio_audio_handler(req: Request) -> web.WebSocketResponse:
    """
    Handles Twilio's specific WebSocket protocol using the Standard TwilioBridge (STT -> LLM -> TTS).
    This supports gpt-4o-mini.
    """
    ws = web.WebSocketResponse()
    await ws.prepare(req)
    
    logger.info("Twilio WebSocket connected (Standard Bridge)")
    
    # Capture query params from the request
    query_params = dict(req.query)
    logger.info(f"WebSocket query params: {query_params}")
    
    # Initialize the Standard Bridge
    # Uses Azure Speech, GPT-4o-Mini, and ElevenLabs
    bridge = TwilioBridge(
        speech_key=os.getenv("AZURE_SPEECH_KEY") or os.getenv("SPEECH_KEY"),
        speech_region=os.getenv("AZURE_SPEECH_REGION") or os.getenv("SPEECH_REGION"),
        elevenlabs_api_key=os.getenv("ELEVENLABS_API_KEY")
    )
    
    # Needs the event loop for thread-safety in callbacks
    bridge.set_loop(asyncio.get_running_loop())
    
    # Adapt aiohttp WS to the interface expected by TwilioBridge
    adapter = AiohttpWebSocketAdapter(ws, query_params=query_params)
    
    try:
        await bridge.handle_websocket(adapter)
    except Exception as e:
        logger.error(f"Bridge error: {e}")
    finally:
        logger.info("Twilio WebSocket connection closed")

    return ws

# ---------------------------------------------------------
# HTTP ENDPOINTS
# ---------------------------------------------------------
async def incoming_call_handler(req: Request) -> Response:
    """
    Handle IncomingCall event from Event Grid.
    """
    try:
        # CloudEvents validation check (OPTIONS)
        if req.method == "OPTIONS":
            return Response(status=200, headers={
                "WebHook-Allowed-Origin": "*",
                "WebHook-Allowed-Rate": "120"
            })

        body = await req.json()
        logger.info(f"Incoming call handler received body: {body}")
        
        events = body if isinstance(body, list) else [body]

        for event in events:
            ev_type = event.get("eventType")
            logger.info(f"Processing event type: {ev_type}")
            
            # Use host from request headers if CALLBACK_URI_HOST is invalid
            host = CALLBACK_URI_HOST
            if not host or "ashysky" not in host:
                requested_host = req.headers.get("Host")
                if requested_host:
                    host = f"https://{requested_host}"
                    logger.info(f"Dynamic host detection: {host}")

            # Validation handshake
            if ev_type in ["Microsoft.EventGrid.SubscriptionValidationEvent", "SubscriptionValidation"]:
                data = event.get("data", {})
                code = data.get("validationCode")
                if code:
                    logger.info(f"Answering validation request: {code}")
                    return web.json_response({"validationResponse": code})
            
            # Check for IncomingCall
            if ev_type == "Microsoft.Communication.IncomingCall":
                data = event["data"]
                incoming_call_context = data["incomingCallContext"]
                caller_id = data.get("from", {}).get("rawId", "unknown")
                
                logger.info(f"Incoming call from {caller_id} with context {incoming_call_context[:20]}...")

                if not call_automation_client or not host:
                    logger.error("Call Automation Config missing - rejecting call")
                    return Response(status=500, text="Configuration Missing")

                # Construct callback URI
                callback_uri = f"{host}/api/callbacks/callEvents"
                websocket_uri = f"{host.replace('https', 'wss')}/api/audio"

                # Media Streaming Options
                media_options = MediaStreamingOptions(
                    transport_url=websocket_uri,
                    transport_type="websocket",
                    content_type="audio",
                    audio_channel_type="mixed",
                    start_media_streaming=True,
                    enable_bidirectional=True,
                    audio_format=AudioFormat.PCM24_K_MONO
                )



                answer_params = {
                    "incoming_call_context": incoming_call_context,
                    "callback_url": callback_uri,
                    "media_streaming": media_options
                }

                # Add Cognitive Services configuration to enable play/recognition
                cognitive_endpoint = os.getenv("COGNITIVE_SERVICES_ENDPOINT")
                if not cognitive_endpoint and SPEECH_REGION:
                    cognitive_endpoint = f"https://{SPEECH_REGION}.api.cognitive.microsoft.com/"
                
                if cognitive_endpoint:
                    try:
                        from azure.communication.callautomation import CallIntelligenceOptions
                        answer_params["call_intelligence_options"] = CallIntelligenceOptions(cognitive_services_endpoint=cognitive_endpoint)
                        logger.info(f"Using CallIntelligenceOptions with endpoint: {cognitive_endpoint}")
                    except (ImportError, Exception) as e:
                        logger.warning(f"Could not set CallIntelligenceOptions: {e}. Proceeding without it.")
                else:
                    logger.info("No cognitive services endpoint found. Proceeding without CallIntelligenceOptions.")

                # Answer the call with robust fallback
                logger.info(f"Answering call with callback={callback_uri}")
                try:
                    # Attempt 1: With intelligence options (if configured)
                    call_automation_client.answer_call(**answer_params)
                    logger.info("Call answered successfully (Attempt 1)")
                except Exception as e:
                    logger.warning(f"Failed to answer call with intelligence options: {e}. Retrying without them...")
                    
                    # Attempt 2: Fallback - remove intelligence options and retry
                    # This ensures the call is answered even if the cognitive services config is invalid
                    answer_params.pop("call_intelligence_options", None)
                    answer_params.pop("cognitive_services_endpoint", None)
                    
                    try:
                        call_automation_client.answer_call(**answer_params)
                        logger.info("Call answered successfully (Attempt 2 - Fallback)")
                    except Exception as retry_e:
                        logger.error(f"Critical failure: Could not answer call even in fallback: {retry_e}")
                        raise retry_e
                
        return Response(status=200)

    except Exception as e:
        logger.exception("Error processing incoming call")
        return Response(status=500)


async def call_events_handler(req: Request) -> Response:
    """
    Handle Call Automation events (Connected, Disconnected, etc.)
    """
    try:
        body = await req.json()
        events = body if isinstance(body, list) else [body]
        
        for event in events:
            ev_type = event.get("type")
            # Try multiple locations for call connection ID
            call_conn_id = event.get("callConnectionId") or event.get("data", {}).get("callConnectionId")
            logger.info(f"Received Call Event: {ev_type} [{call_conn_id}]")
            logger.debug(f"Full event: {event}")
            
            if ev_type == "Microsoft.Communication.CallConnected":
                logger.info("Call Connected - Playing greeting")
                try:
                    if not call_conn_id:
                        logger.error(f"No call connection ID found in event: {event}")
                        continue
                        
                    # Get the call connection to play audio
                    call_connection = call_automation_client.get_call_connection(call_conn_id)
                    
                    # Instead of TTS (which requires complex resource linking), 
                    # we use a publicly accessible WAV file for the greeting.
                    from azure.communication.callautomation import FileSource
                    
                    # Standard welcome audio file
                    greeting_url = "https://www.soundjay.com/buttons/beep-01a.wav" # Fallback beep
                    # Better greeting:
                    greeting_url = "https://voicecs-agent.ashysky-8dede81f.uksouth.azurecontainerapps.io/static/welcome.wav"
                    
                    # Actually, I'll use a known working Azure sample URL if possible, 
                    # or just create a static folder in my app.
                    
                    file_source = FileSource(url="https://github.com/Azure-Samples/communication-services-python-quickstarts/raw/main/CallAutomation_IncomingCall/static/sample-greeting.wav")
                    
                    # Play the greeting to all participants
                    call_connection.play_media(play_source=file_source)
                    logger.info(f"Greeting played successfully for call {call_conn_id}")
                except Exception as play_error:
                    logger.error(f"Error playing greeting: {play_error}")
                
            elif ev_type in ["Microsoft.Communication.CallDisconnected", "Microsoft.Communication.CallTransferAccepted"]:
                # Cleanup bridge
                if call_conn_id in active_bridges:
                    logger.info(f"Cleaning up bridge for {call_conn_id}")
                    active_bridges[call_conn_id].stop()
                    del active_bridges[call_conn_id]

        return Response(status=200)
    except Exception as e:
        logger.exception("Error processing call event")
        return Response(status=500)


async def audio_websocket_handler(req: Request) -> web.StreamResponse:
    """
    WebSocket endpoint for bidirectional audio streaming.
    ACS connects here.
    """
    ws = web.WebSocketResponse()
    await ws.prepare(req)
    
    logger.info("New WebSocket connection for audio")
    
    # We don't have the call_connection_id immediately in the WS handshake 
    # unless passed in query param? ACS documentation says it sends metadata first.
    
    bridge = None
    call_connection_id = None
    
    try:
        async for msg in ws:
            if msg.type == WSMsgType.BINARY:
                data = msg.data
                # Parse packet to determine type (Metadata vs Audio)
                # ACS Audio Protocol: JSON Metadata or Binary Audio
                # Actually, ACS sends a JSON string first with config.
                
                # Check if it's JSON (metadata)
                try:
                    # Naively try to parse as JSON first? 
                    # Or check first byte?
                    # ACS Stream: 
                    # Packet: [Kind (4 bytes string len) + Kind String + Payload]??
                    # No, it's simpler usually.
                    
                    # Wait, ACS Media Streaming over WebSocket protocol:
                    # It sends JSON text messages for metadata.
                    # It sends BINARY messages for audio.
                    if bridge:
                        bridge.write_audio(data)
                except Exception as e:
                    logger.error(f"Error handling binary: {e}")

            elif msg.type == WSMsgType.TEXT:
                # Metadata
                try:
                    meta = json.loads(msg.data)
                    kind = meta.get("kind")
                    if kind == "AudioMetadata":
                        call_connection_id = meta.get("callConnectionId")
                        logger.info(f"WebSocket linked to Call: {call_connection_id}")
                        
                        if AOAI_API_KEY and AOAI_ENDPOINT:
                            # Create Realtime Bridge
                            bridge = RealtimeVoiceBridge(AOAI_API_KEY, AOAI_ENDPOINT, AOAI_MODEL)
                            
                            async def send_to_ws(audio_bytes):
                                try:
                                    if not ws.closed:
                                        await ws.send_bytes(audio_bytes)
                                except Exception as e:
                                    logger.error(f"Error sending audio to ACS WS: {e}")
                            
                            # Start the bridge in a background task
                            # Note: The start method has its own await conn loop
                            asyncio.create_task(bridge.start(send_to_ws))
                            
                            if call_connection_id:
                                active_bridges[call_connection_id] = bridge
                        else:
                            logger.error("Cannot start Realtime bridge: Missing AOAI_API_KEY/ENDPOINT")
                            
                except Exception as e:
                    logger.error(f"Error parsing metadata: {e}")

            elif msg.type == WSMsgType.ERROR:
                logger.error('ws connection closed with exception %s', ws.exception())

    except Exception as e:
        logger.exception("WebSocket loop error")
    finally:
        logger.info("WebSocket closed")
        if bridge:
            bridge.stop()
    
    return ws


async def messages(req: Request) -> Response:
    """
    Main bot endpoint - receives messages from Bot Framework.
    Replaces the /acs/callhandler endpoint.
    """
    # Verify content type
    if "application/json" not in req.headers.get("Content-Type", ""):
        return Response(status=415, text="Unsupported Media Type")
    
    # Parse activity
    body = await req.json()
    activity = Activity().deserialize(body)
    
    # Get auth header
    auth_header = req.headers.get("Authorization", "")
    
    # Process activity through Bot Framework adapter
    response = await adapter.process_activity(activity, auth_header, bot.on_turn)
    
    if response:
        return web.json_response(data=response.body, status=response.status)
    return Response(status=200)


async def health(req: Request) -> Response:
    """
    Health check endpoint.
    """
    return web.json_response({
        "status": "ok",
        "mode": "bot-framework",
        "client_id": CLIENT_ID,
        "industry": INDUSTRY
    })


async def health_route(req: Request) -> Response:
    """
    Diagnostic route to test phone routing logic.
    Query param: called_number
    """
    called_number = req.query.get("called_number", "")
    if not called_number:
        return web.json_response({
            "status": "error",
            "error": "called_number is required"
        }, status=400)
    client_id = os.getenv("CLIENT_ID")
    industry = os.getenv("INDUSTRY")

    try:
        from shared_code.utils.config_loader import load_phone_mappings
        mappings = load_phone_mappings()
        client_id, industry, mapping_found, candidate_used, candidates = resolve_routing(
            called_number,
            mappings,
            client_id,
            industry,
        )
    except Exception as e:
        return web.json_response({
            "status": "error",
            "error": str(e),
        }, status=500)

    return web.json_response({
        "status": "ok",
        "called_number": called_number,
        "resolved_client_id": client_id,
        "resolved_industry": industry,
        "mapping_found": mapping_found,
        "candidate_used": candidate_used,
        "candidates": candidates,
    })


# ---------------------------------------------------------
# APPLICATION SETUP
# ---------------------------------------------------------
app = web.Application()

# Register routes
app.router.add_post("/api/messages", messages)
app.router.add_get("/health", health)
app.router.add_get("/health/route", health_route)

app.router.add_post("/tw-voice", twilio_voice_handler)
app.router.add_post("/api/incoming-call", twilio_voice_handler)
app.router.add_get("/api/audio-twilio", twilio_audio_handler)

# ACS Call Automation Routes (DEPRECATED but kept for stability)
app.router.add_post("/api/callbacks/incomingCall", incoming_call_handler)
app.router.add_options("/api/callbacks/incomingCall", incoming_call_handler)
app.router.add_post("/api/callbacks/callEvents", call_events_handler)
app.router.add_get("/api/audio", audio_websocket_handler)

# Log all requests
@web.middleware
async def logging_middleware(request: Request, handler):
    logger.info(f"Incoming request: {request.method} {request.path}")
    response = await handler(request)
    logger.info(f"Response status: {response.status}")
    return response

app.middlewares.append(logging_middleware)

# ---------------------------------------------------------
# RUN APPLICATION
# ---------------------------------------------------------
if __name__ == "__main__":
    port = int(os.getenv("PORT", 8000))
    logger.info(f"Starting bot on port {port}")
    web.run_app(app, host="0.0.0.0", port=port)
