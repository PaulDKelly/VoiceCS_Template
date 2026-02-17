import os
from shared_code.routing.intent_router import detect_intent
from shared_code.agent.workflow_router import route_to_workflow
from shared_code.utils.session import load_session, save_session
from shared_code.utils.config_loader import load_merged_config


def run_agent_step(session_id: str, text: str) -> dict:
    session = load_session(session_id)

    # Ensure client/industry are present in session
    client_id = session.get("client_id") or os.getenv("CLIENT_ID")
    industry = session.get("industry") or os.getenv("INDUSTRY")
    session["client_id"] = client_id
    session["industry"] = industry
    
    # 1. Initialize First Response if no intent active
    if not session.get("intent"):
        print(f"DEBUG: Starting new call session for {client_id}. Initializing first_response.", flush=True)
        session["intent"] = "first_response"
        session["current_node_id"] = None # Ensure we start at beginning
        save_session(session_id, session)

    # 2. Handle Case where session exists but intent was cleared (Safety)
    if not session.get("intent"):
         session["intent"] = "first_response"
         save_session(session_id, session)

    save_session(session_id, session)
    config = load_merged_config(client_id, industry)

    # 3. Route to active workflow
    previous_intent = session.get("intent")
    result = route_to_workflow(previous_intent, session_id, text)

    # Update caller memory (best-effort)
    try:
        phone_number = session.get("phone_number")
        enable_caller_memory = bool(config.get("enable_caller_memory", False))
        if enable_caller_memory and phone_number:
            from shared_code.utils.caller_memory import load_caller_memory, save_caller_memory
            memory = load_caller_memory(phone_number)
            if session.get("customer_name"):
                memory["name"] = session.get("customer_name")
            if session.get("intent"):
                memory["last_intent"] = session.get("intent")
            if text and text != "__start__":
                memory["last_utterance"] = text.strip()[:200]
            save_caller_memory(phone_number, memory)
        elif phone_number:
            # If disabled, ensure any previous memory note doesn't linger in session
            session.pop("caller_memory", None)
    except Exception:
        pass
    
    # 4. Check for immediate handoff (Intent Switch within the result)
    # The engines might have updated the session intent.
    new_session = result.get("session", session)
    new_intent = new_session.get("intent")

    if result.get("handoff_complete"):
        return result

    if new_intent and new_intent != previous_intent:
        print(f"DEBUG: Intent switch detected: {previous_intent} -> {new_intent}. Rerouting immediately...", flush=True)
        # Pass empty text so the new workflow generates its initial state/question
        return route_to_workflow(new_intent, session_id, "")
        
    return result


def _result(prompt: str, session: dict, config: dict) -> dict:
    return {"prompt": prompt, "session": session, "config": config}


def _extract_name_smartly(text: str) -> str:
    """
    Extracts just the name from a sentence using LLM.
    Returns None if no name found.
    """
    from shared_code.llm.aoai_client import chat_completion
    
    if not text or not text.strip():
        return None

    system_prompt = (
        "You are a strict name extractor. "
        "Extract the person's name from the text. "
        "1. If the text is just a greeting (e.g. 'Hello', 'Hi', 'Good morning'), return NOTHING. "
        "2. If the text is a confirmation (e.g. 'Yeah', 'Okay', 'Sure', 'Yes'), return NOTHING. "
        "3. If the input is ambiguous or could be a common noun, return NOTHING. "
        "4. Only return a name if you are confident it is a proper noun referring to the user. "
        "5. If the text is 'My name is Kim', return 'Kim'. "
        "Return ONLY the name. No punctuation. If none found, return NOTHING."
    )
    
    response = chat_completion([
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": text}
    ])
    
    if not response:
        return None
        
    cleaned = response.strip().replace(".", "")
    banned = {
        "hello", "hi", "hey", "nothing", "none",
        "there", "here", "someone", "anyone", "unknown",
        "yes", "yeah", "yep", "okay", "ok", "sure",
        "mate", "buddy", "pal", "friend", "sir", "madam"
    }
    if len(cleaned) < 2 or cleaned.lower() in banned:
        return None
        
    return cleaned
