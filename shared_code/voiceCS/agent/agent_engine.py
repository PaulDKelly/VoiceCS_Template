import os
import json
from dateutil import parser
from shared_code.voiceCS.routing.intent_router import detect_intent
from shared_code.voiceCS.routing.state_machine import next_state
from shared_code.voiceCS.utils.session import load_session, save_session
from shared_code.voiceCS.utils.config_loader import load_merged_config
from shared_code.voiceCS.utils.workflow_loader import load_workflow
from shared_code.voiceCS.utils.prompt_builder import build_state_prompt
from shared_code.voiceCS.config.required_fields import REQUIRED_FIELDS
from shared_code.voiceCS.utils.extractors import extract_name


def run_agent_step(
    session_id: str,
    text: str,
    client_id: str | None = None,
    industry: str | None = None,
) -> dict:
    """
    Core agent orchestration logic.
    Returns a dict: { "prompt": str, "session": dict, "config": dict }
    """

    # Load existing session
    session = load_session(session_id)

    # ---------------------------------------------------------
    # Persist client + industry
    # ---------------------------------------------------------
    client_id = client_id or session.get("client_id") or os.getenv("CLIENT_ID")
    industry = industry or session.get("industry") or os.getenv("INDUSTRY")

    session["client_id"] = client_id
    session["industry"] = industry
    save_session(session_id, session)

    # Load merged config
    config = load_merged_config(client_id, industry)

    # ---------------------------------------------------------
    # 0. GREETING
    # ---------------------------------------------------------
    if not session.get("greeted"):
        assistant = config.get("assistant_name") or config.get("agent_name") or "our agent"
        brand = config.get("brand_name", "our company")

        session["greeted"] = True
        session["awaiting_field"] = "customer_name"
        save_session(session_id, session)

        prompt = (
            f"Hi, I’m {assistant} with {brand}. "
            f"Before we get into the details, can I take your name?"
        )
        return _result(prompt, session, config)

    # ---------------------------------------------------------
    # 1. REQUIRED FIELDS
    # ---------------------------------------------------------
    awaiting = session.get("awaiting_field")

    if awaiting:
        if awaiting == "customer_name":
            session["customer_name"] = extract_name(text)
        else:
            session[awaiting] = text

        session["awaiting_field"] = None
        save_session(session_id, session)

    # Ask next required field if missing
    for field in REQUIRED_FIELDS:
        key = field["key"]
        if key not in session:
            session["awaiting_field"] = key
            save_session(session_id, session)
            return _result(field["prompt"], session, config)

    # ---------------------------------------------------------
    # 2. INTENT QUESTION PHASE
    # ---------------------------------------------------------
    if session.get("intent") is None and session.get("state") is None:
        if not session.get("awaiting_intent"):
            session["awaiting_intent"] = True
            save_session(session_id, session)
            return _result("How can I help you today?", session, config)

    # ---------------------------------------------------------
    # 3. INTENT DETECTION (ONLY WHEN AWAITING INTENT)
    # ---------------------------------------------------------
    if session.get("awaiting_intent"):
        detected = detect_intent(text, client_id, industry)

        if not detected:
            return _result(
                "Sorry, I didn’t quite catch that. How can I help you today?",
                session,
                config,
            )

        session["intent"] = detected
        session["state"] = "start"
        session["awaiting_intent"] = False
        save_session(session_id, session)

    intent = session.get("intent")
    state = session.get("state")

    # ---------------------------------------------------------
    # 4. WORKFLOW CAPTURE
    # ---------------------------------------------------------
    workflow = load_workflow(intent, client_id, industry)
    state_def = workflow["states"].get(state, {})

    capture_field = state_def.get("capture")
    if capture_field:

        if capture_field == "purchase_date":
            try:
                parsed = parser.parse(text, fuzzy=True)
                session["purchase_date"] = parsed.date().isoformat()
            except Exception:
                session["purchase_date"] = None

        elif capture_field == "customer_name":
            session["customer_name"] = extract_name(text)

        else:
            session[capture_field] = text

        save_session(session_id, session)

    # ---------------------------------------------------------
    # 5. STATE MACHINE
    # ---------------------------------------------------------
    new_state = next_state(intent, session)
    session["state"] = new_state
    save_session(session_id, session)

    # ---------------------------------------------------------
    # 6. PROMPT FOR NEW STATE
    # ---------------------------------------------------------
    prompt = build_state_prompt(intent, client_id, industry, new_state)
    return _result(prompt, session, config)


def _result(prompt: str, session: dict, config: dict) -> dict:
    return {
        "prompt": prompt,
        "session": session,
        "config": config,
    }
