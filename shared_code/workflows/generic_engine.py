import os
import json
import sqlite3
import importlib
from typing import Optional, Dict, Any
from datetime import date as _date, datetime as _datetime
from shared_code.utils.session import load_session, save_session
from shared_code.utils.config_loader import load_merged_config
from shared_code.llm.aoai_client import chat_completion
import re

_AFFIRMATIVE_WORDS = {
    "yes", "yeah", "yep", "yup", "correct", "please", "ok", "okay", "sure", "go ahead",
    "continue", "proceed", "book it", "do it", "that's right", "thats right"
}
_NEGATIVE_WORDS = {
    "no", "nope", "nah", "not now", "don't", "dont", "stop", "cancel", "incorrect", "wrong"
}

def _to_date_spoken(d: _date) -> str:
    return f"{_ordinal_day(d.day)} of {d.strftime('%B %Y')}"


def _normalize_date_input(text: str) -> str:
    cleaned = str(text or "").strip().lower()
    cleaned = cleaned.replace(",", " ")
    cleaned = re.sub(r"(\d{1,2})(st|nd|rd|th)\b", r"\1", cleaned)
    cleaned = re.sub(r"\s{2,}", " ", cleaned).strip()
    return cleaned


def _parse_date_like(text: str) -> Optional[_date]:
    raw = _normalize_date_input(text)
    if not raw:
        return None

    formats = [
        "%d/%m/%Y", "%d-%m-%Y", "%Y-%m-%d",
        "%d %m %Y", "%d %B %Y", "%d %b %Y",
        "%B %d %Y", "%b %d %Y",
        "%d/%m/%y", "%d-%m-%y", "%d %m %y",
    ]
    for fmt in formats:
        try:
            return _datetime.strptime(raw, fmt).date()
        except Exception:
            pass

    today = _date.today()
    no_year_formats = ["%d/%m", "%d-%m", "%d %m", "%d %B", "%d %b", "%B %d", "%b %d"]
    for fmt in no_year_formats:
        try:
            parsed = _datetime.strptime(raw, fmt).date().replace(year=today.year)
            if parsed < today:
                parsed = parsed.replace(year=today.year + 1)
            return parsed
        except Exception:
            pass

    return None


def _parse_time_like(text: str) -> Optional[str]:
    raw = str(text or "").strip().lower()
    if not raw:
        return None
    m = re.search(r"\b(\d{1,2})(?:(:|\.)(\d{2}))?\s*(am|pm)?\b", raw)
    if not m:
        return None

    hour = int(m.group(1))
    minute = int(m.group(3)) if m.group(3) else 0
    meridiem = m.group(4)

    if minute < 0 or minute > 59:
        return None

    if meridiem:
        if hour < 1 or hour > 12:
            return None
        if meridiem == "pm" and hour != 12:
            hour += 12
        if meridiem == "am" and hour == 12:
            hour = 0
    else:
        if hour < 0 or hour > 23:
            return None

    return f"{hour:02d}:{minute:02d}"


def _looks_like_date_correction(text: str) -> bool:
    raw = _normalize_text(text)
    if not raw:
        return False
    has_year = bool(re.search(r"\b(19|20)\d{2}\b", raw))
    has_slash_or_dash_date = bool(re.search(r"\b\d{1,2}[/-]\d{1,2}([/-]\d{2,4})?\b", raw))
    has_month = bool(re.search(r"\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)\w*\b", raw))
    has_correction_phrase = any(p in raw for p in ("not", "instead", "actually", "i mean", "sorry"))
    return has_year or has_slash_or_dash_date or has_month or has_correction_phrase


def _strip_correction_prefix(text: str) -> str:
    raw = str(text or "").strip()
    if not raw:
        return raw
    patterns = [
        r"^\s*(?:no[, ]+)?i\s+meant\s+",
        r"^\s*no[, ]+sorry[, ]+",
        r"^\s*sorry[, ]+",
        r"^\s*actually[, ]+",
        r"^\s*correction[, ]+",
        r"^\s*it(?:'s| is)\s+",
    ]
    out = raw
    for pat in patterns:
        out = re.sub(pat, "", out, flags=re.IGNORECASE)
    return out.strip() or raw


def _normalize_registration(text: str) -> str:
    return re.sub(r"[^A-Za-z0-9]", "", str(text or "")).upper().strip()


def _is_valid_registration(text: str) -> bool:
    reg = _normalize_registration(text)
    return bool(re.fullmatch(r"[A-Z0-9]{5,8}", reg))


def _normalize_phone(text: str) -> str:
    raw = str(text or "").strip()
    if raw.startswith("+"):
        return "+" + re.sub(r"\D", "", raw)
    return re.sub(r"\D", "", raw)


def _is_valid_phone(text: str) -> bool:
    digits = re.sub(r"\D", "", str(text or ""))
    return 10 <= len(digits) <= 15


def _is_valid_email(text: str) -> bool:
    raw = str(text or "").strip()
    return re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", raw) is not None


def _extract_dtmf_digit(text: str) -> Optional[str]:
    raw = str(text or "").strip().lower()
    if not raw:
        return None
    m = re.match(r"^dtmf\s*:\s*([0-9])$", raw)
    if m:
        return m.group(1)
    if re.fullmatch(r"[0-9]", raw):
        return raw
    return None


def _map_dtmf_to_intent(digit: str, config: dict) -> Optional[str]:
    mapping = config.get("intent_dtmf_map")
    if isinstance(mapping, dict):
        target = mapping.get(str(digit))
        return str(target).strip() if target else None

    intents = set(config.get("intents") or [])
    defaults = {
        "1": "warranty",
        "2": "service",
        "3": "sales",
        "4": "finance",
        "5": "general",
    }
    candidate = defaults.get(str(digit))
    if candidate in intents:
        return candidate
    return None


def _first_response_intent_prompt(config: dict) -> str:
    return (
        config.get("prompts", {}).get("intent_capture_retry")
        or "I did not catch that. Please say warranty, service, sales, finance, or general enquiry. "
           "You can also press 1 for warranty, 2 for service, 3 for sales, 4 for finance."
    )


def _is_valid_name(value: str) -> bool:
    if not value:
        return False
    cleaned = value.strip()
    if len(cleaned) < 2:
        return False
    if cleaned.isdigit():
        return False
    if not re.search(r"[A-Za-z]", cleaned):
        return False
    banned = {
        "there", "here", "someone", "anyone", "unknown",
        "yes", "yeah", "yep", "okay", "ok", "sure",
        "mate", "buddy", "pal", "friend", "sir", "madam",
        "oh", "uh", "um", "erm", "hmm", "mm", "mmm"
    }
    if cleaned.lower() in banned:
        return False
    return True

def handle_generic_workflow(session_id: str, text: str) -> dict:
    session = load_session(session_id)
    config = load_merged_config(session.get("client_id"), session.get("industry"))
    
    # Track text for actions that need it (e.g. name extraction)
    if text:
        session["_last_user_input"] = text
    
    intent = session.get("intent", "general")
    workflow = config.get("workflows", {}).get(intent)
    
    if not workflow:
        from shared_code.workflows.general_engine import handle_general
        return handle_general(session_id, text)

    nodes = workflow.get("nodes", [])
    edges = workflow.get("edges", [])
    
    current_node_id = session.get("current_node_id")
    
    # 1. Start logic
    if not current_node_id:
        # Find start node (usually type 'input' or no incoming edges, or just pick first one if none)
        start_node = next((n for n in nodes if n.get("type") == "input"), None)
        if not start_node:
            start_node = nodes[0] if nodes else None
        
        if not start_node:
            return {"prompt": "I'm sorry, I'm having trouble starting this workflow.", "session": session, "config": config}
        
        current_node_id = start_node["id"]
        # Skip straight to prompt generation for start node
        session["current_node_id"] = current_node_id
        save_session(session_id, session)
        return _process_node(current_node_id, nodes, edges, session, config, session_id)

    # 2. Step Traversal (we were already at a node, now processing user response)
    current_node = next((n for n in nodes if n["id"] == current_node_id), None)
    if not current_node:
        session["current_node_id"] = None # Reset
        save_session(session_id, session)
        return handle_generic_workflow(session_id, text)

    # 3. Capture Logic
    capture_var = current_node.get("data", {}).get("captureVariable")
    if capture_var and text:
        captured = text.strip()
        captured = _strip_correction_prefix(captured)
        # Normalize common spoken punctuation artifacts from STT (e.g. "Paul Kelly.")
        captured = re.sub(r"[.!?,;:]+$", "", captured).strip()
        capture_name = str(capture_var or "").lower()
        if capture_var == "preferredDate":
            parsed_date = _parse_date_like(captured)
            if not parsed_date:
                save_session(session_id, session)
                return {
                    "prompt": "I did not catch the appointment date. Please say the date, for example 14 March 2026.",
                    "session": session,
                    "config": config,
                }
            today = _date.today()
            if parsed_date < today:
                save_session(session_id, session)
                return {
                    "prompt": (
                        f"I cannot book dates in the past. Today is {_to_date_spoken(today)}. "
                        "Please give me a date from today onward."
                    ),
                    "session": session,
                    "config": config,
                }
            session[capture_var] = parsed_date.isoformat()
            print(f"DEBUG: Captured normalized date '{session[capture_var]}' into variable '{capture_var}'", flush=True)
        elif capture_var == "preferredTime":
            # Handle date corrections while user is on the time slot question.
            if _looks_like_date_correction(captured):
                corrected_date = _parse_date_like(captured)
                if corrected_date:
                    today = _date.today()
                    if corrected_date < today:
                        save_session(session_id, session)
                        return {
                            "prompt": (
                                f"Thanks for the correction. That date is in the past, and today is {_to_date_spoken(today)}. "
                                "Please tell me a valid date first."
                            ),
                            "session": session,
                            "config": config,
                        }
                    session["preferredDate"] = corrected_date.isoformat()
                    save_session(session_id, session)
                    return {
                        "prompt": (
                            f"Thanks, I have updated the date to {_to_date_spoken(corrected_date)}. "
                            "What time would you like for the appointment?"
                        ),
                        "session": session,
                        "config": config,
                    }
            parsed_time = _parse_time_like(captured)
            if not parsed_time:
                save_session(session_id, session)
                return {
                    "prompt": "I did not catch the appointment time. Please say a time, for example 10 30 AM.",
                    "session": session,
                    "config": config,
                }
            session[capture_var] = parsed_time
            print(f"DEBUG: Captured normalized time '{session[capture_var]}' into variable '{capture_var}'", flush=True)
        elif capture_var == "customer_name":
            if _is_valid_name(captured):
                session[capture_var] = captured
                session.pop("_name_retry", None)
                print(f"DEBUG: Captured '{text}' into variable '{capture_var}'", flush=True)
            else:
                retries = int(session.get("_name_retry") or 0)
                if retries < 1:
                    session["_name_retry"] = retries + 1
                    save_session(session_id, session)
                    return {
                        "prompt": "Sorry, I didn’t catch your name — could you repeat it?",
                        "session": session,
                        "config": config,
                    }
                # Give up on name after one retry, proceed without it
                session.pop("customer_name", None)
                session.pop("_name_retry", None)
                print(f"DEBUG: Invalid name '{text}' after retry; proceeding without name.", flush=True)
        elif any(k in capture_name for k in ("vehiclereg", "registration", "rego", "reg_number", "regnumber")):
            normalized_reg = _normalize_registration(captured)
            if not _is_valid_registration(normalized_reg):
                save_session(session_id, session)
                return {
                    "prompt": "I did not catch a valid registration. Please say it again slowly, for example N D 74 E P N.",
                    "session": session,
                    "config": config,
                }
            session[capture_var] = normalized_reg
            print(f"DEBUG: Captured normalized reg '{normalized_reg}' into variable '{capture_var}'", flush=True)
        elif any(k in capture_name for k in ("phone", "mobile", "contact", "tel")):
            if "@" in captured and _is_valid_email(captured):
                # If caller gives email in contact slot, keep it and continue.
                session[capture_var] = captured.lower()
                print(f"DEBUG: Captured email in contact slot '{capture_var}'", flush=True)
            else:
                normalized_phone = _normalize_phone(captured)
                if not _is_valid_phone(normalized_phone):
                    save_session(session_id, session)
                    return {
                        "prompt": "I did not catch a valid phone number. Please repeat it including area code.",
                        "session": session,
                        "config": config,
                    }
                session[capture_var] = normalized_phone
                print(f"DEBUG: Captured normalized phone '{normalized_phone}' into variable '{capture_var}'", flush=True)
        elif "email" in capture_name:
            normalized_email = captured.lower()
            if not _is_valid_email(normalized_email):
                save_session(session_id, session)
                return {
                    "prompt": "I did not catch a valid email address. Please repeat it clearly.",
                    "session": session,
                    "config": config,
                }
            session[capture_var] = normalized_email
            print(f"DEBUG: Captured normalized email '{normalized_email}' into variable '{capture_var}'", flush=True)
        else:
            session[capture_var] = captured
            print(f"DEBUG: Captured '{text}' into variable '{capture_var}'", flush=True)

    # 3b. Strict first-response intent gating (prevents accidental auto-advance on noise/echo)
    strict_first_response = bool(config.get("strict_first_response", True))
    node_data = current_node.get("data", {}) or {}
    node_prompt_key = str(node_data.get("promptKey") or "")
    if (
        strict_first_response
        and session.get("intent") == "first_response"
        and node_prompt_key == "first_response_ask_intent"
    ):
        user_text = str(text or "").strip()
        if not user_text:
            save_session(session_id, session)
            return {"prompt": _first_response_intent_prompt(config), "session": session, "config": config}

        digit = _extract_dtmf_digit(user_text)
        if digit:
            forced_intent = _map_dtmf_to_intent(digit, config)
            if forced_intent:
                session["_forced_intent"] = forced_intent
            else:
                save_session(session_id, session)
                return {"prompt": _first_response_intent_prompt(config), "session": session, "config": config}
        else:
            from shared_code.routing.intent_router import detect_intent
            detected_intent = detect_intent(
                user_text, session.get("client_id"), session.get("industry"), allow_llm=False
            )
            if not detected_intent:
                save_session(session_id, session)
                return {"prompt": _first_response_intent_prompt(config), "session": session, "config": config}
            session["_forced_intent"] = detected_intent

    # 4. Decide Next Node
    outgoing_edges = [e for e in edges if e["source"] == current_node_id]
    
    if not outgoing_edges:
        # Check if it's a handoff node (though handoff node usually jumps workflow)
        if current_node.get("type") == "handoff":
            target = current_node.get("data", {}).get("targetWorkflow")
            if target:
                session["intent"] = target
                session["current_node_id"] = None
                save_session(session_id, session)
                from shared_code.agent.workflow_router import route_to_workflow
                return route_to_workflow(target, session_id, text)
        
        return {"prompt": "Thank you for that information. Is there anything else I can help with?", "session": session, "config": config}

    next_node_id = _decide_next_node(text, outgoing_edges, nodes, session, config)
    
    if not next_node_id:
        return {"prompt": "I'm not sure I understood. Could you elaborate?", "session": session, "config": config}

    session["current_node_id"] = next_node_id
    save_session(session_id, session)
    
    return _process_node(next_node_id, nodes, edges, session, config, session_id)

def _process_node(node_id: str, nodes: list, edges: list, session: dict, config: dict, session_id: str) -> dict:
    node = next((n for n in nodes if n["id"] == node_id), None)
    if not node:
         return {"prompt": "Workflow Error: Node not found.", "session": session, "config": config}

    # 1. Handoff Execution
    if node.get("type") == "handoff":
        target = node.get("data", {}).get("targetWorkflow")
        if target:
            session["intent"] = target
            session["current_node_id"] = None
            save_session(session_id, session)
            from shared_code.agent.workflow_router import route_to_workflow
            return route_to_workflow(target, session_id, "")

    # 2. Action Execution
    if node.get("type") == "action":
        action_result = _execute_action(node, session, config)
        if action_result:
            if action_result.get("prompt"):
                # If a direct prompt is returned, stop traversal and reply immediately
                next_node_id = action_result.get("next_node_id")
                session["current_node_id"] = next_node_id if isinstance(next_node_id, str) and next_node_id else None
                save_session(session_id, session)
                return {"prompt": action_result["prompt"], "session": session, "config": config}

            if action_result.get("handoff_intent"):
                target_intent = action_result["handoff_intent"]
                session["intent"] = target_intent
                session["current_node_id"] = None
                save_session(session_id, session)
                from shared_code.agent.workflow_router import route_to_workflow
                last_text = session.get("_last_user_input", "") or ""
                result = route_to_workflow(target_intent, session_id, last_text)
                result["handoff_complete"] = True
                return result
        # Actions are transparent to the user, move to next node immediately
        outgoing = [e for e in edges if e["source"] == node_id]
        if outgoing:
            next_id = outgoing[0]["target"]
            session["current_node_id"] = next_id
            save_session(session_id, session)
            return _process_node(next_id, nodes, edges, session, config, session_id)
        else:
            return {"prompt": "I've processed your request. Is there anything else? [HANGUP]", "session": session, "config": config}

    # 3. Auto-skip utility nodes with no prompt mapping (e.g. Start/Decision/Condition).
    # This prevents reading editor labels like "Decision" to callers.
    data = node.get("data", {}) or {}
    node_type = str(node.get("type") or "")
    label = str(data.get("label") or "").strip()
    prompt_key = data.get("promptKey")
    prompt_key_with_name = data.get("promptKeyWithName")
    capture_var = data.get("captureVariable")
    label_lower = label.lower()
    is_utility_node = (
        node_type in ("input", "custom_input")
        or node_id.startswith("condition_")
        or label_lower in {"decision", "condition", "route", "router", "branch", "switch"}
    )
    if (
        is_utility_node
        and not prompt_key
        and not prompt_key_with_name
        and not capture_var
    ):
        outgoing = [e for e in edges if e["source"] == node_id]
        if outgoing:
            route_text = str(session.get("_last_user_input") or "")
            next_id = _decide_next_node(route_text, outgoing, nodes, session, config)
            if next_id:
                session["current_node_id"] = next_id
                save_session(session_id, session)
                return _process_node(next_id, nodes, edges, session, config, session_id)

    # 4. Generate Prompt
    data = node.get("data", {}) or {}
    prompt_key = data.get("promptKey")
    prompt_key_with_name = data.get("promptKeyWithName")
    name_val = session.get("customer_name") or session.get("name")
    if (
        prompt_key_with_name
        and config.get("enable_caller_memory")
        and isinstance(name_val, str)
        and _is_valid_name(name_val)
    ):
        prompt_key = prompt_key_with_name
    if prompt_key:
        prompt_value = config.get("prompts", {}).get(prompt_key)
        if isinstance(prompt_value, str) and prompt_value.strip() and prompt_value.strip() != "...":
            prompt = prompt_value
        else:
            # Never speak technical/missing prompt keys aloud in production calls.
            print(f"WARN: Missing or placeholder prompt for key '{prompt_key}'", flush=True)
            prompt = "Could you tell me a bit more so I can help you with this?"
    else:
        prompt = node.get("data", {}).get("label", "Next step...")

    # Resolve variables in prompt
    def replace_var(match):
        var_name = match.group(1)

        # Common aliases
        if var_name == "assistant":
            return str(
                session.get("assistant")
                or config.get("assistant_name")
                or config.get("agent_name")
                or "agent"
            )
        if var_name == "brand":
            return str(
                session.get("brand")
                or config.get("brand_name")
                or config.get("default_brand_name")
                or "brand"
            )
        if var_name == "name":
            name_val = session.get("customer_name") or session.get("name")
            if isinstance(name_val, str):
                cleaned = name_val.strip()
                banned = {
                    "there", "here", "someone", "anyone", "unknown",
                    "yes", "yeah", "yep", "okay", "ok", "sure",
                    "mate", "buddy", "pal", "friend", "sir", "madam"
                }
                if cleaned and cleaned.lower() not in banned:
                    return cleaned
            return ""
        if var_name == "caller_memory":
            return str(session.get("caller_memory") or "")

        # Default: session/config with dotted-path support (e.g. {db.phone})
        resolved = _resolve_template_var(var_name, session, config)
        if resolved is None:
            return ""
        resolved_text = str(resolved)
        return _to_spoken_value(var_name, resolved_text)

    prompt = re.sub(r"\{([\w\.]+)\}", replace_var, prompt)
    # Remove any remaining unresolved placeholders safely.
    prompt = re.sub(r"\{[^{}]+\}", "", prompt)
    prompt = re.sub(r"\[[^\[\]]+\]", "", prompt)
    # Clean up punctuation/spacing if {name} was empty
    prompt = re.sub(r",\s*([?.!])", r"\1", prompt)
    prompt = re.sub(r"\s+([?.!])", r"\1", prompt)
    prompt = re.sub(r"\s{2,}", " ", prompt).strip()

    # Fail-safe: never return an empty prompt (prevents silent turns on call).
    if not prompt:
        prompt = "Could you say that again so I can help you with this?"

    try:
        print(
            f"DEBUG: Generic node reply | intent={session.get('intent')} node_id={node_id} prompt_key={prompt_key} prompt_len={len(prompt)}",
            flush=True,
        )
    except Exception:
        pass

    return {"prompt": prompt, "session": session, "config": config}

def _decide_next_node(text: str, edges: list, nodes: list, session: dict, config: dict) -> Optional[str]:
    if len(edges) == 1:
        return edges[0]["target"]

    binary = _classify_binary_response(text)
    if binary:
        matched = [e for e in edges if _edge_matches_binary(e, nodes, binary)]
        if len(matched) == 1:
            return matched[0]["target"]
    
    # Branching logic
    options = []
    for e in edges:
        label = e.get("label", "Continue")
        options.append(f"NodeID: {e['target']}, Logic: {label}")
    
    system_prompt = (
        "Based on the user input, decide which workflow path to take. "
        "User said: " + text + "\n"
        "Options:\n" + "\n".join(options) + "\n"
        "Return ONLY the NodeID of the best match. No explanation."
    )
    
    response = chat_completion([{"role": "system", "content": system_prompt}])
    best_id = response.strip()
    
    # Validate against actual edges
    if any(e["target"] == best_id for e in edges):
        return best_id
    
    return edges[0]["target"] # Default fallback


def _normalize_text(value: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9\s']", " ", str(value or "").lower())
    cleaned = re.sub(r"\s{2,}", " ", cleaned).strip()
    return cleaned


def _classify_binary_response(text: str) -> Optional[str]:
    cleaned = _normalize_text(text)
    if not cleaned:
        return None
    if cleaned in _AFFIRMATIVE_WORDS:
        return "yes"
    if cleaned in _NEGATIVE_WORDS:
        return "no"
    if cleaned.startswith("yes ") or cleaned.startswith("yeah ") or cleaned.startswith("ok "):
        return "yes"
    if cleaned.startswith("no ") or cleaned.startswith("nah "):
        return "no"
    return None


def _edge_matches_binary(edge: dict, nodes: list, binary: str) -> bool:
    label = _normalize_text(edge.get("label", ""))
    target = next((n for n in nodes if n.get("id") == edge.get("target")), {}) or {}
    target_label = _normalize_text((target.get("data") or {}).get("label", ""))
    combined = f"{label} {target_label}".strip()
    yes_markers = ("yes", "proceed", "continue", "book", "confirm", "next")
    no_markers = ("no", "cancel", "stop", "restart", "back", "not now")
    markers = yes_markers if binary == "yes" else no_markers
    return any(marker in combined for marker in markers)

def _execute_action(node: dict, session: dict, config: dict):
    data = node.get("data", {})
    action_type = data.get("actionType")
    action_config = data.get("actionConfig", {})
    
    # Import locally to avoid circular dependencies
    from shared_code.utils.session import save_session

    print(f"DEBUG: Executing Action '{action_type}'", flush=True)

    if action_type == 'email':
        from shared_code.utils.email_client import send_generic_email
        to = action_config.get("to")
        subject = action_config.get("subject", "Workflow Update")
        body = f"Workflow Action Triggered.\nSession Data: {json.dumps(session, indent=2)}"
        send_generic_email(to, subject, body)

    elif action_type == 'sms':
        print(f"SMS TODO: Send to {action_config.get('phone')}", flush=True)

    elif action_type == 'webhook':
        import requests
        url = action_config.get("url")
        if url:
            try:
                requests.post(url, json=session, timeout=5)
            except Exception as e:
                print(f"ERROR: Webhook failed: {e}", flush=True)

    elif action_type == 'whisper':
        import requests
        account_sid = os.getenv("TWILIO_ACCOUNT_SID")
        auth_token = os.getenv("TWILIO_AUTH_TOKEN")
        if not account_sid or not auth_token:
            print("WARN: Whisper action skipped (TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN missing).", flush=True)
            return None

        target_number = action_config.get("target_number") or config.get("whisper_target_number")
        if not target_number:
            print("WARN: Whisper action skipped (target number missing).", flush=True)
            return None

        from_number = session.get("called_number") or os.getenv("TWILIO_FROM_NUMBER")
        if not from_number:
            print("WARN: Whisper action skipped (from number missing).", flush=True)
            return None

        message = action_config.get("message") or "Calling to provide an update from the voice assistant."
        # Basic template replacement from session/config
        for key, val in {
            "assistant": config.get("assistant_name") or config.get("agent_name") or "agent",
            "brand": config.get("brand_name") or config.get("default_brand_name") or "brand",
            "name": session.get("customer_name") or "",
            "phone": session.get("phone_number") or "",
        }.items():
            message = message.replace(f"{{{key}}}", str(val))

        twiml = f"<Response><Say voice=\"Polly.Amy\">{message}</Say></Response>"
        try:
            requests.post(
                f"https://api.twilio.com/2010-04-01/Accounts/{account_sid}/Calls.json",
                auth=(account_sid, auth_token),
                data={"To": target_number, "From": from_number, "Twiml": twiml},
                timeout=10,
            )
            print(f"DEBUG: Whisper call placed to {target_number} from {from_number}", flush=True)
        except Exception as e:
            print(f"ERROR: Whisper action failed: {e}", flush=True)

    elif action_type == 'extract_name':
        # Reuse logic from agent_engine
        from shared_code.agent.agent_engine import _extract_name_smartly
        # We need the user's last text. 
        # In generic_engine, 'text' is passed to handle_generic_workflow. 
        # We need to make sure _execute_action can access it if needed, 
        # but usually actions process what was just captured.
        last_text = session.get("_last_user_input", "")
        name = _extract_name_smartly(last_text)
        if name and _is_valid_name(name):
            session["customer_name"] = name
            session.pop("_name_retry", None)
            print(f"DEBUG: ExtractName action found: {name}", flush=True)
        elif name:
            print(f"DEBUG: ExtractName action discarded invalid name: {name}", flush=True)

    elif action_type == 'detect_intent':
        forced_intent = session.pop("_forced_intent", None)
        if forced_intent:
            print(f"DEBUG: DetectIntent action using forced intent: {forced_intent}.", flush=True)
            return {"handoff_intent": forced_intent}

        fixed_intent = action_config.get("fixed_intent") or action_config.get("target_intent")
        if fixed_intent:
            print(f"DEBUG: DetectIntent action using fixed intent: {fixed_intent}.", flush=True)
            return {"handoff_intent": fixed_intent}

        from shared_code.routing.intent_router import detect_intent
        last_text = session.get("_last_user_input", "")
        # Use keyword-only routing for deterministic workflow handoff
        intent = detect_intent(last_text, session.get("client_id"), session.get("industry"), allow_llm=False)
        if not intent:
            # No intent matched: provide a polite fallback prompt
            fallback = (
                config.get("prompts", {}).get("intent_not_recognized")
                or "Sorry, I’m not able to help with that. Is there anything else I can assist you with?"
            )
            retry_node = action_config.get("retry_node")
            if not retry_node and session.get("intent") == "first_response":
                # Keep retry on intent question instead of restarting at greeting.
                retry_node = "fr3"
            print("DEBUG: DetectIntent action found no intent. Using fallback prompt.", flush=True)
            return {"prompt": fallback, "next_node_id": retry_node}
        print(f"DEBUG: DetectIntent action found: {intent}. Switching workflow.", flush=True)
        return {"handoff_intent": intent}

    elif action_type == 'database_query':
        return _execute_database_query(action_config, session, config)

    elif action_type == 'knowledge_search':
        return _execute_knowledge_search(action_config, session, config)

    elif action_type == 'update_session':
        updates = action_config.get("updates", {})
        for k, v in updates.items():
            session[k] = v
            print(f"DEBUG: SessionUpdate {k}={v}", flush=True)


def _resolve_action_connection(action_config: dict, config: dict) -> tuple[dict, str]:
    connections = config.get("database_connections") or {}
    conn_ref = action_config.get("connection_ref")
    base = {}
    if conn_ref and isinstance(connections, dict):
        candidate = connections.get(conn_ref)
        if isinstance(candidate, dict):
            base = candidate

    merged = dict(base)
    for field in [
        "type", "host", "port", "database", "username", "password", "password_env",
        "connection_string", "sqlite_path",
        "sslmode", "sslrootcert", "sslcert", "sslkey",
        "supabase_url", "supabase_key", "supabase_key_env"
    ]:
        if action_config.get(field) not in (None, ""):
            merged[field] = action_config.get(field)

    db_type = str(
        merged.get("type")
        or action_config.get("database_type")
        or "custom"
    ).strip().lower()
    return merged, db_type


def _build_query_and_params(query_template: str, db_type: str, session: dict, config: dict):
    placeholder = "%s" if db_type in ("postgres", "mysql") else "?"

    names = re.findall(r"\{(\w+)\}", query_template or "")
    params = []
    query = query_template
    for name in names:
        value = session.get(name, config.get(name))
        if isinstance(value, (dict, list)):
            value = json.dumps(value)
        params.append(value)
        query = query.replace("{" + name + "}", placeholder, 1)

    return query, params


def _rows_to_dicts(cursor, rows):
    if not cursor.description:
        return []
    cols = [d[0] for d in cursor.description]
    out = []
    for row in rows:
        out.append({cols[i]: row[i] for i in range(min(len(cols), len(row)))})
    return out


def _connect_db(conn_cfg: dict, db_type: str, timeout_seconds: float):
    password = conn_cfg.get("password")
    if not password and conn_cfg.get("password_env"):
        password = os.getenv(str(conn_cfg.get("password_env")))

    if db_type == "sqlite":
        sqlite_path = conn_cfg.get("sqlite_path") or conn_cfg.get("database") or conn_cfg.get("connection_string")
        if not sqlite_path:
            raise RuntimeError("SQLite requires sqlite_path (or database/connection_string).")
        conn = sqlite3.connect(sqlite_path, timeout=timeout_seconds)
        return conn, "sqlite"

    if db_type == "postgres":
        try:
            psycopg2 = importlib.import_module("psycopg2")
        except Exception:
            raise RuntimeError("PostgreSQL driver not installed (psycopg2).")
        kwargs = {
            "host": conn_cfg.get("host"),
            "port": int(conn_cfg.get("port")) if conn_cfg.get("port") else 5432,
            "dbname": conn_cfg.get("database"),
            "user": conn_cfg.get("username"),
            "password": password,
            "connect_timeout": int(timeout_seconds),
        }
        for ssl_key in ("sslmode", "sslrootcert", "sslcert", "sslkey"):
            ssl_val = conn_cfg.get(ssl_key)
            if ssl_val not in (None, ""):
                kwargs[ssl_key] = ssl_val
        if conn_cfg.get("connection_string"):
            return psycopg2.connect(conn_cfg.get("connection_string"), connect_timeout=int(timeout_seconds)), "postgres"
        return psycopg2.connect(**kwargs), "postgres"

    if db_type == "mysql":
        try:
            pymysql = importlib.import_module("pymysql")
        except Exception:
            raise RuntimeError("MySQL driver not installed (pymysql).")
        kwargs = {
            "host": conn_cfg.get("host"),
            "port": int(conn_cfg.get("port")) if conn_cfg.get("port") else 3306,
            "database": conn_cfg.get("database"),
            "user": conn_cfg.get("username"),
            "password": password,
            "connect_timeout": int(timeout_seconds),
            "read_timeout": int(timeout_seconds),
            "write_timeout": int(timeout_seconds),
            "charset": "utf8mb4",
            "autocommit": True,
        }
        if conn_cfg.get("connection_string"):
            raise RuntimeError("MySQL connection_string is not supported in this adapter. Use host/port/database/username/password.")
        return pymysql.connect(**kwargs), "mysql"

    # sqlserver + custom are routed to pyodbc with connection string.
    try:
        pyodbc = importlib.import_module("pyodbc")
    except Exception:
        raise RuntimeError("ODBC driver not installed (pyodbc) for SQL Server/Custom connections.")

    connection_string = conn_cfg.get("connection_string")
    if not connection_string and db_type == "sqlserver":
        host = conn_cfg.get("host") or ""
        database = conn_cfg.get("database") or ""
        username = conn_cfg.get("username") or ""
        driver = conn_cfg.get("driver") or "ODBC Driver 18 for SQL Server"
        if host and database and username and password:
            connection_string = (
                f"DRIVER={{{driver}}};SERVER={host};DATABASE={database};"
                f"UID={username};PWD={password};Encrypt=yes;TrustServerCertificate=yes;"
            )
    if not connection_string:
        raise RuntimeError("Custom/SQL Server connection requires connection_string.")

    return pyodbc.connect(connection_string, timeout=int(timeout_seconds)), "odbc"


def _execute_database_query(action_config: dict, session: dict, config: dict):
    conn_cfg, db_type = _resolve_action_connection(action_config, config)
    query_template = action_config.get("query_template") or action_config.get("query")
    if not query_template and db_type != "supabase_rest":
        print("WARN: Database query skipped (query_template missing).", flush=True)
        return None

    max_rows = int(action_config.get("max_rows") or 10)
    timeout_seconds = float(action_config.get("timeout_seconds") or 5)
    single_row = bool(action_config.get("single_row"))
    result_var = action_config.get("result_var") or "db_result"

    try:
        if db_type == "supabase_rest":
            return _execute_supabase_rest_query(
                action_config=action_config,
                conn_cfg=conn_cfg,
                session=session,
                config=config,
                max_rows=max_rows,
                single_row=single_row,
                result_var=result_var,
                timeout_seconds=timeout_seconds,
            )

        query, params = _build_query_and_params(query_template, db_type, session, config)
        conn, _ = _connect_db(conn_cfg, db_type, timeout_seconds)
        try:
            cur = conn.cursor()
            cur.execute(query, params)
            if cur.description:
                rows = cur.fetchmany(max_rows)
                result_rows = _rows_to_dicts(cur, rows)
                session[result_var] = (result_rows[0] if result_rows else None) if single_row else result_rows
            else:
                try:
                    conn.commit()
                except Exception:
                    pass
                session[result_var] = {"rows_affected": cur.rowcount}
            print(f"DEBUG: Database query stored result in '{result_var}'", flush=True)
        finally:
            try:
                conn.close()
            except Exception:
                pass
        return None
    except Exception as e:
        err_text = f"{type(e).__name__}: {e}"
        session[f"{result_var}_error"] = err_text
        print(f"ERROR: Database query action failed: {err_text}", flush=True)
        if action_config.get("error_prompt"):
            return {"prompt": action_config.get("error_prompt")}
        return None

def _resolve_template_var(var_name: str, session: dict, config: dict):
    # Support dotted paths like {db.phone}
    parts = str(var_name or "").split(".")
    root = parts[0]
    if root in session:
        value = session.get(root)
    elif root in config:
        value = config.get(root)
    else:
        return None
    for p in parts[1:]:
        if isinstance(value, dict):
            value = value.get(p)
        else:
            return None
    return value


def _to_spoken_phone(value: str) -> str:
    raw = str(value or "").strip()
    if not raw:
        return raw
    # Conservative detection: only format values that are basically phone-like.
    if re.search(r"[A-Za-z]", raw):
        return raw

    has_plus = raw.startswith("+")
    digits = re.sub(r"\D", "", raw)
    if len(digits) < 7 or len(digits) > 15:
        return raw

    spoken = ", ".join(list(digits))
    if has_plus:
        return f"plus, {spoken}"
    return spoken


def _to_spoken_email(value: str) -> str:
    raw = str(value or "").strip()
    if "@" not in raw:
        return raw
    spoken = raw
    spoken = spoken.replace("@", " at ")
    spoken = spoken.replace(".", " dot ")
    spoken = spoken.replace("-", " dash ")
    spoken = spoken.replace("_", " underscore ")
    spoken = re.sub(r"\s{2,}", " ", spoken).strip()
    return spoken


def _to_spoken_postcode(value: str) -> str:
    raw = str(value or "").strip().upper()
    if not raw:
        return raw
    compact = re.sub(r"\s+", "", raw)
    # UK-style conservative check: alnum 5-8 chars.
    if not re.fullmatch(r"[A-Z0-9]{5,8}", compact):
        return value
    return ", ".join(list(compact))


def _ordinal_day(n: int) -> str:
    spoken_ordinals = {
        1: "first",
        2: "second",
        3: "third",
        4: "fourth",
        5: "fifth",
        6: "sixth",
        7: "seventh",
        8: "eighth",
        9: "ninth",
        10: "tenth",
        11: "eleventh",
        12: "twelfth",
        13: "thirteenth",
        14: "fourteenth",
        15: "fifteenth",
        16: "sixteenth",
        17: "seventeenth",
        18: "eighteenth",
        19: "nineteenth",
        20: "twentieth",
        21: "twenty first",
        22: "twenty second",
        23: "twenty third",
        24: "twenty fourth",
        25: "twenty fifth",
        26: "twenty sixth",
        27: "twenty seventh",
        28: "twenty eighth",
        29: "twenty ninth",
        30: "thirtieth",
        31: "thirty first",
    }
    return spoken_ordinals.get(int(n), str(n))


def _to_spoken_date(value: str) -> str:
    raw = str(value or "").strip()
    if not raw:
        return raw

    date_part = raw.split("T", 1)[0].split(" ", 1)[0]
    parsed = None
    for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y"):
        try:
            parsed = _datetime.strptime(date_part, fmt).date()
            break
        except Exception:
            pass

    # Also support already-human dates like "21 October 2024".
    if not parsed:
        normalized = re.sub(r"(\d{1,2})(st|nd|rd|th)\b", r"\1", raw, flags=re.IGNORECASE)
        for fmt in ("%d %B %Y", "%d %b %Y"):
            try:
                parsed = _datetime.strptime(normalized, fmt).date()
                break
            except Exception:
                pass

    if not parsed:
        return raw
    return f"{_ordinal_day(parsed.day)} of {parsed.strftime('%B %Y')}"


def _to_spoken_reference(value: str) -> str:
    raw = str(value or "").strip()
    if not raw:
        return raw
    compact = re.sub(r"[\s\-_/]", "", raw)
    # Keep this strict so normal text is not over-processed.
    if not re.fullmatch(r"[A-Za-z0-9]{4,24}", compact):
        return value
    has_letter = bool(re.search(r"[A-Za-z]", compact))
    has_digit = bool(re.search(r"\d", compact))
    if not (has_letter and has_digit):
        return value
    return ", ".join(list(compact.upper()))


def _to_spoken_value(var_name: str, value: str) -> str:
    name = str(var_name or "").lower()
    text = str(value or "")
    if any(k in name for k in ("phone", "mobile", "tel")):
        return _to_spoken_phone(text)
    if "email" in name:
        return _to_spoken_email(text)
    if any(k in name for k in ("date", "warranty_start", "warranty_end", "start_date", "end_date")):
        return _to_spoken_date(text)
    if any(k in name for k in ("postcode", "post_code", "zip")):
        return _to_spoken_postcode(text)
    if any(k in name for k in ("reference", "ref", "ticket", "case", "order", "id")):
        return _to_spoken_reference(text)
    return text


def _replace_vars(template: str, session: dict, config: dict, url_encode: bool = False) -> str:
    import urllib.parse

    def _repl(match):
        key = match.group(1)
        value = _resolve_template_var(key, session, config)
        if value is None:
            value = ""
        if isinstance(value, (dict, list)):
            value = json.dumps(value)
        value = str(value)
        return urllib.parse.quote(value, safe="") if url_encode else value

    return re.sub(r"\{([\w\.]+)\}", _repl, template or "")


def _execute_supabase_rest_query(
    action_config: dict,
    conn_cfg: dict,
    session: dict,
    config: dict,
    max_rows: int,
    single_row: bool,
    result_var: str,
    timeout_seconds: float,
):
    import requests

    endpoint_template = (
        action_config.get("endpoint")
        or action_config.get("query_template")
        or action_config.get("query")
        or ""
    )
    if not endpoint_template:
        raise RuntimeError("Supabase REST requires endpoint (or query_template).")

    base_url = (
        conn_cfg.get("supabase_url")
        or conn_cfg.get("host")
        or conn_cfg.get("connection_string")
        or ""
    ).strip()
    if not base_url:
        raise RuntimeError("Supabase REST requires supabase_url on the connection.")

    endpoint = _replace_vars(endpoint_template, session, config, url_encode=True)
    if endpoint.startswith("http://") or endpoint.startswith("https://"):
        url = endpoint
    else:
        url = f"{base_url.rstrip('/')}/{endpoint.lstrip('/')}"

    key = conn_cfg.get("supabase_key") or conn_cfg.get("password")
    if not key and conn_cfg.get("supabase_key_env"):
        key = os.getenv(str(conn_cfg.get("supabase_key_env")))
    if not key and conn_cfg.get("password_env"):
        key = os.getenv(str(conn_cfg.get("password_env")))

    headers = {"Accept": "application/json"}
    if key:
        headers["apikey"] = str(key)
        headers["Authorization"] = f"Bearer {key}"

    custom_headers = action_config.get("headers")
    if isinstance(custom_headers, dict):
        for k, v in custom_headers.items():
            headers[str(k)] = str(v)

    method = str(action_config.get("http_method") or action_config.get("method") or "GET").upper()
    body = None
    body_template = action_config.get("body_template")
    if body_template:
        rendered = _replace_vars(str(body_template), session, config, url_encode=False)
        try:
            body = json.loads(rendered)
        except Exception:
            body = {"raw": rendered}

    res = requests.request(
        method=method,
        url=url,
        headers=headers,
        json=body if method in ("POST", "PUT", "PATCH", "DELETE") else None,
        timeout=timeout_seconds,
    )
    if not res.ok:
        raise RuntimeError(f"Supabase REST failed ({res.status_code}): {res.text[:400]}")

    try:
        payload = res.json()
    except Exception:
        payload = res.text

    if isinstance(payload, list):
        trimmed = payload[:max_rows]
        session[result_var] = trimmed[0] if (single_row and trimmed) else (None if single_row else trimmed)
    else:
        session[result_var] = payload

    print(f"DEBUG: Supabase REST query stored result in '{result_var}'", flush=True)
    return None


def _resolve_knowledge_connection(action_config: dict, config: dict) -> dict:
    connections = config.get("knowledge_base_connections") or {}
    behavior = config.get("knowledge_base_behavior") or {}
    conn_ref = (
        action_config.get("kb_connection_ref")
        or behavior.get("default_connection_ref")
        or config.get("knowledge_base_default_connection")
    )
    base = {}
    if conn_ref and isinstance(connections, dict):
        candidate = connections.get(conn_ref)
        if isinstance(candidate, dict):
            base = candidate

    merged = dict(base)
    for field in [
        "type",
        "endpoint", "index_name", "api_version",
        "api_key", "api_key_env",
        "supabase_url", "supabase_key", "supabase_key_env",
        "host", "port", "database", "username", "password", "password_env",
        "connection_string", "schema", "query_sql",
        "sslmode", "sslrootcert", "sslcert", "sslkey",
        "http_method", "body_template",
        "content_field", "title_field",
    ]:
        if action_config.get(field) not in (None, ""):
            merged[field] = action_config.get(field)
    return merged


def _normalize_kb_domain(value: Any) -> str:
    text = str(value or "").strip().lower()
    if not text:
        return ""
    text = re.sub(r"[\s\-]+", "_", text)
    text = re.sub(r"[^a-z0-9_]", "", text)
    return text


def _kb_scope_domains(action_config: dict, session: dict, config: dict) -> set[str]:
    behavior = config.get("knowledge_base_behavior") or {}
    scope_mode = str(
        action_config.get("kb_scope")
        or behavior.get("scope_mode")
        or "workflow"
    ).strip().lower()

    if scope_mode in ("none", "off", "global"):
        return set()

    explicit = action_config.get("kb_domains") or action_config.get("allowed_domains")
    domains: list[str] = []
    if isinstance(explicit, str):
        domains = [d.strip() for d in explicit.split(",")]
    elif isinstance(explicit, list):
        domains = [str(d).strip() for d in explicit if str(d).strip()]

    if not domains:
        active_intent = _normalize_kb_domain(session.get("intent"))
        if active_intent:
            domains.append(active_intent)

    include_general = bool(behavior.get("include_general", True))
    if include_general:
        domains.append("general")

    normalized = {_normalize_kb_domain(d) for d in domains if _normalize_kb_domain(d)}
    return normalized


def _hit_domains(raw: Any) -> set[str]:
    if not isinstance(raw, dict):
        return set()
    keys = ("domain", "domains", "workflow", "intent", "category", "topic")
    out: set[str] = set()
    for key in keys:
        value = raw.get(key)
        if isinstance(value, list):
            for item in value:
                d = _normalize_kb_domain(item)
                if d:
                    out.add(d)
        else:
            d = _normalize_kb_domain(value)
            if d:
                out.add(d)
    return out


def _apply_kb_scope(hits: list[dict], allowed_domains: set[str]) -> list[dict]:
    if not allowed_domains or not hits:
        return hits
    filtered = []
    for h in hits:
        hit_domains = _hit_domains(h.get("raw"))
        # Keep unknown-domain hits to avoid dropping all results when metadata is sparse.
        if not hit_domains or (hit_domains & allowed_domains):
            filtered.append(h)
    return filtered


def _execute_postgres_knowledge_search(
    action_config: dict,
    kb_cfg: dict,
    session: dict,
    config: dict,
    query_text: str,
    allowed_domains: set[str],
    top_k: int,
    timeout_seconds: float,
    result_var: str,
    content_field: str,
    title_field: str,
):
    sql_template = str(
        action_config.get("sql_query")
        or kb_cfg.get("query_sql")
        or ""
    ).strip()
    if not sql_template:
        raise RuntimeError("Knowledge search (PostgreSQL) requires query_sql.")

    session_for_sql = dict(session or {})
    session_for_sql["query_text"] = query_text
    session_for_sql["top_k"] = top_k
    session_for_sql["kb_domains_csv"] = ",".join(sorted(allowed_domains)) if allowed_domains else ""
    session_for_sql["kb_domain"] = next(iter(sorted(allowed_domains)), "")

    query, params = _build_query_and_params(sql_template, "postgres", session_for_sql, config)
    conn, _ = _connect_db(kb_cfg, "postgres", timeout_seconds)
    try:
        cur = conn.cursor()
        schema = str(kb_cfg.get("schema") or "").strip()
        if schema:
            if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", schema):
                raise RuntimeError("Knowledge search (PostgreSQL) schema is invalid.")
            cur.execute(f"SET search_path TO {schema}")

        cur.execute(query, params)
        if not cur.description:
            raise RuntimeError("Knowledge search (PostgreSQL) query must return rows.")

        rows = cur.fetchmany(max(top_k, 1))
        docs = _rows_to_dicts(cur, rows)

        hits = []
        for d in docs:
            if not isinstance(d, dict):
                continue
            title = d.get(title_field) or d.get("title") or d.get("name") or d.get("heading") or ""
            content = (
                d.get(content_field)
                or d.get("content")
                or d.get("text")
                or d.get("chunk")
                or d.get("body")
                or d.get("summary")
                or ""
            )
            score = d.get("score")
            if score is None:
                score = d.get("similarity")
            if score is None:
                score = d.get("distance")
            hits.append({
                "title": str(title or ""),
                "content": str(content or ""),
                "score": score,
                "raw": d,
            })

        hits = _apply_kb_scope(hits, allowed_domains)

        summary_lines = []
        for h in hits:
            if h["title"] and h["content"]:
                summary_lines.append(f"{h['title']}: {h['content']}")
            elif h["content"]:
                summary_lines.append(h["content"])
            elif h["title"]:
                summary_lines.append(h["title"])
        summary = " ".join([s.strip() for s in summary_lines if s.strip()][:top_k]).strip()

        session[result_var] = {
            "query": query_text,
            "summary": summary,
            "hits": hits,
            "provider": "postgres",
        }
        print(f"DEBUG: Knowledge search (PostgreSQL) stored result in '{result_var}' ({len(hits)} hits)", flush=True)
        return len(hits)
    finally:
        try:
            conn.close()
        except Exception:
            pass


def _execute_knowledge_search(action_config: dict, session: dict, config: dict):
    import requests

    kb_cfg = _resolve_knowledge_connection(action_config, config)
    kb_type = str(kb_cfg.get("type") or "").strip().lower()
    if not kb_type:
        if kb_cfg.get("supabase_url"):
            kb_type = "supabase_rest"
        elif kb_cfg.get("host") or kb_cfg.get("connection_string") or kb_cfg.get("database"):
            kb_type = "postgres"
        else:
            kb_type = "azure_search"

    endpoint = str(kb_cfg.get("endpoint") or "").strip()
    index_name = str(kb_cfg.get("index_name") or "").strip()
    api_version = str(kb_cfg.get("api_version") or "2023-11-01").strip()
    query_template = str(action_config.get("query_template") or "{_last_user_input}").strip()
    top_k = int(action_config.get("top_k") or 3)
    timeout_seconds = float(action_config.get("timeout_seconds") or 6)

    content_field = str(kb_cfg.get("content_field") or "content").strip()
    title_field = str(kb_cfg.get("title_field") or "title").strip()
    result_var = str(action_config.get("result_var") or "kb").strip()

    no_results_prompt = action_config.get("no_results_prompt")
    error_prompt = action_config.get("error_prompt")
    respond_immediately = bool(action_config.get("respond_immediately"))

    query_text = _replace_vars(query_template, session, config, url_encode=False).strip()
    if not query_text:
        query_text = str(session.get("_last_user_input") or "").strip()

    allowed_domains = _kb_scope_domains(action_config, session, config)
    if allowed_domains:
        # Domain hint improves retrieval relevance even when backend query is generic.
        query_text = f"[domain:{','.join(sorted(allowed_domains))}] {query_text}".strip()

    if kb_type in ("postgres", "supabase_postgres"):
        try:
            hit_count = _execute_postgres_knowledge_search(
                action_config=action_config,
                kb_cfg=kb_cfg,
                session=session,
                config=config,
                query_text=query_text,
                allowed_domains=allowed_domains,
                top_k=top_k,
                timeout_seconds=timeout_seconds,
                result_var=result_var,
                content_field=content_field,
                title_field=title_field,
            )
            if (hit_count or 0) == 0 and no_results_prompt:
                return {"prompt": str(no_results_prompt)}
            if respond_immediately:
                summary = str((session.get(result_var) or {}).get("summary") or "").strip()
                if summary:
                    return {"prompt": summary}
            return None
        except Exception as e:
            err_text = f"{type(e).__name__}: {e}"
            session[f"{result_var}_error"] = err_text
            print(f"ERROR: Knowledge search action failed: {err_text}", flush=True)
            if error_prompt:
                return {"prompt": str(error_prompt)}
            return None

    if kb_type == "supabase_rest":
        base_url = (
            kb_cfg.get("supabase_url")
            or kb_cfg.get("endpoint")
            or ""
        ).strip()
        endpoint_template = (
            action_config.get("endpoint")
            or kb_cfg.get("endpoint_path")
            or kb_cfg.get("query_template")
            or kb_cfg.get("endpoint")
            or ""
        )
        if not base_url:
            err_text = "Knowledge search (Supabase) requires supabase_url."
            session[f"{result_var}_error"] = err_text
            if error_prompt:
                return {"prompt": error_prompt}
            return None
        if not endpoint_template:
            err_text = "Knowledge search (Supabase) requires endpoint path (e.g. /rest/v1/rpc/match_documents)."
            session[f"{result_var}_error"] = err_text
            if error_prompt:
                return {"prompt": error_prompt}
            return None

        key = kb_cfg.get("supabase_key") or kb_cfg.get("api_key")
        if not key and kb_cfg.get("supabase_key_env"):
            key = os.getenv(str(kb_cfg.get("supabase_key_env")))
        if not key and kb_cfg.get("api_key_env"):
            key = os.getenv(str(kb_cfg.get("api_key_env")))
        if not key:
            err_text = "Knowledge search (Supabase) API key is missing (supabase_key/supabase_key_env)."
            session[f"{result_var}_error"] = err_text
            if error_prompt:
                return {"prompt": error_prompt}
            return None

        endpoint = _replace_vars(str(endpoint_template), session, config, url_encode=True)
        if endpoint.startswith("http://") or endpoint.startswith("https://"):
            url = endpoint
        else:
            url = f"{base_url.rstrip('/')}/{endpoint.lstrip('/')}"

        method = str(action_config.get("http_method") or kb_cfg.get("http_method") or "POST").upper()
        body_template = action_config.get("body_template") or kb_cfg.get("body_template")
        body = None
        if body_template:
            rendered = _replace_vars(str(body_template), session, config, url_encode=False)
            try:
                body = json.loads(rendered)
            except Exception:
                body = {"query": query_text, "raw": rendered}
        else:
            body = {"query_text": query_text, "match_count": top_k}

        headers = {
            "Accept": "application/json",
            "Content-Type": "application/json",
            "apikey": str(key),
            "Authorization": f"Bearer {key}",
        }
        custom_headers = action_config.get("headers")
        if isinstance(custom_headers, dict):
            for k, v in custom_headers.items():
                headers[str(k)] = str(v)

        try:
            res = requests.request(
                method=method,
                url=url,
                headers=headers,
                json=body if method in ("POST", "PUT", "PATCH", "DELETE") else None,
                timeout=timeout_seconds,
            )
            if not res.ok:
                raise RuntimeError(f"Knowledge search (Supabase) failed ({res.status_code}): {res.text[:400]}")

            payload = res.json()
            if isinstance(payload, list):
                docs = payload
            elif isinstance(payload, dict) and isinstance(payload.get("data"), list):
                docs = payload.get("data")
            elif isinstance(payload, dict) and isinstance(payload.get("value"), list):
                docs = payload.get("value")
            elif isinstance(payload, dict):
                docs = [payload]
            else:
                docs = []

            hits = []
            for d in docs[: max(top_k, 1)]:
                if not isinstance(d, dict):
                    continue
                title = d.get(title_field) or d.get("title") or d.get("name") or d.get("heading") or ""
                content = (
                    d.get(content_field)
                    or d.get("content")
                    or d.get("text")
                    or d.get("chunk")
                    or d.get("body")
                    or d.get("summary")
                    or ""
                )
                score = d.get("score")
                if score is None:
                    score = d.get("similarity")
                if score is None:
                    score = d.get("@search.score")
                hits.append({
                    "title": str(title or ""),
                    "content": str(content or ""),
                    "score": score,
                    "raw": d,
                })

            hits = _apply_kb_scope(hits, allowed_domains)

            summary_lines = []
            for h in hits:
                if h["title"] and h["content"]:
                    summary_lines.append(f"{h['title']}: {h['content']}")
                elif h["content"]:
                    summary_lines.append(h["content"])
                elif h["title"]:
                    summary_lines.append(h["title"])
            summary = " ".join([s.strip() for s in summary_lines if s.strip()][:top_k]).strip()

            session[result_var] = {
                "query": query_text,
                "summary": summary,
                "hits": hits,
                "provider": "supabase_rest",
            }
            print(f"DEBUG: Knowledge search (Supabase) stored result in '{result_var}' ({len(hits)} hits)", flush=True)

            if not hits and no_results_prompt:
                return {"prompt": str(no_results_prompt)}
            if respond_immediately and summary:
                return {"prompt": summary}
            return None
        except Exception as e:
            err_text = f"{type(e).__name__}: {e}"
            session[f"{result_var}_error"] = err_text
            print(f"ERROR: Knowledge search action failed: {err_text}", flush=True)
            if error_prompt:
                return {"prompt": str(error_prompt)}
            return None

    if not endpoint or not index_name:
        err_text = "Knowledge search requires endpoint and index_name."
        session[f"{result_var}_error"] = err_text
        if error_prompt:
            return {"prompt": error_prompt}
        return None

    api_key = kb_cfg.get("api_key")
    if not api_key and kb_cfg.get("api_key_env"):
        api_key = os.getenv(str(kb_cfg.get("api_key_env")))

    if not api_key:
        err_text = "Knowledge search API key is missing (api_key or api_key_env)."
        session[f"{result_var}_error"] = err_text
        if error_prompt:
            return {"prompt": error_prompt}
        return None

    base = endpoint.rstrip("/")
    url = f"{base}/indexes/{index_name}/docs/search?api-version={api_version}"
    headers = {"Content-Type": "application/json", "api-key": str(api_key)}
    payload = {
        "search": query_text or "*",
        "top": top_k,
    }

    try:
        res = requests.post(url, headers=headers, json=payload, timeout=timeout_seconds)
        if not res.ok:
            raise RuntimeError(f"Knowledge search failed ({res.status_code}): {res.text[:400]}")

        data = res.json()
        docs = data.get("value") if isinstance(data, dict) else None
        docs = docs if isinstance(docs, list) else []

        hits = []
        for d in docs:
            if not isinstance(d, dict):
                continue
            title = d.get(title_field) or d.get("title") or d.get("name") or ""
            content = d.get(content_field) or d.get("content") or d.get("text") or ""
            score = d.get("@search.score")
            hits.append({
                "title": str(title or ""),
                "content": str(content or ""),
                "score": score,
                "raw": d,
            })

        hits = _apply_kb_scope(hits, allowed_domains)

        summary_lines = []
        for h in hits:
            if h["title"] and h["content"]:
                summary_lines.append(f"{h['title']}: {h['content']}")
            elif h["content"]:
                summary_lines.append(h["content"])
            elif h["title"]:
                summary_lines.append(h["title"])

        summary = " ".join([s.strip() for s in summary_lines if s.strip()][:top_k]).strip()

        session[result_var] = {
            "query": query_text,
            "summary": summary,
            "hits": hits,
        }
        print(f"DEBUG: Knowledge search stored result in '{result_var}' ({len(hits)} hits)", flush=True)

        if not hits and no_results_prompt:
            return {"prompt": str(no_results_prompt)}

        if respond_immediately and summary:
            return {"prompt": summary}

        return None
    except Exception as e:
        err_text = f"{type(e).__name__}: {e}"
        session[f"{result_var}_error"] = err_text
        print(f"ERROR: Knowledge search action failed: {err_text}", flush=True)
        if error_prompt:
            return {"prompt": str(error_prompt)}
        return None
