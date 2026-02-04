from datetime import datetime
from dateutil import parser

from shared_code.utils.session import load_session, save_session
from shared_code.utils.config_loader import load_merged_config
from shared_code.llm.aoai_client import chat_completion


def handle_warranty(session_id: str, text: str) -> dict:
    """
    Hybrid warranty workflow:
    1. Ensure purchase date is known (deterministic).
    2. Evaluate warranty status (deterministic).
    3. Use config to decide redirect vs capture_details (deterministic).
    4. Optionally use LLM to interpret / clarify the issue description.
    """
    session = load_session(session_id)
    config = load_merged_config(session.get("client_id"), session.get("industry"))

    # Step 1 — Ask purchase date if not known
    if "purchase_date" not in session:
        # Try to parse this turn as a date
        try:
            parsed = parser.parse(text, fuzzy=True)
            session["purchase_date"] = parsed.date().isoformat()
            save_session(session_id, session)
            
            # Recalculate status immediately
            # If valid date capture, we should Prompt for the issue now.
            # We don't want to fall through and treat '2022' as the issue description.
            
            # Determine status to give correct context
            warranty_months = config.get("warranty_period_months", 36)
            status = _evaluate_warranty_status(session["purchase_date"], warranty_months)
            
            if status == "out_of_warranty":
                # Fall through to the out-of-warranty logic below
                pass 
            else:
                # In warranty -> Immediate Handoff to Service
                session["intent"] = "service"
                save_session(session_id, session)
                return _result("Redirecting to service...", session, config)
        except Exception:
            # Could not parse a date → ask explicitly
            prompt = config.get("prompts", {}).get("warranty_ask_purchase_date", 
                "Do you know roughly when the vehicle was purchased?")
            return _result(prompt, session, config)

    # Step 2 — Evaluate warranty status (deterministic)
    purchase_date = session.get("purchase_date")
    warranty_months = config.get("warranty_period_months", 36)
    outcome = config.get("warranty_outcome", "redirect")  # redirect | capture_details

    status = _evaluate_warranty_status(purchase_date, warranty_months)

    # Step 3 — Out of warranty paths (deterministic)
    if status == "out_of_warranty":
        if outcome == "redirect":
            # No more details, polite redirect + “anything else?”
            session["awaiting_intent"] = True
            save_session(session_id, session)
            
            default_prompt = (
                "Thanks for that. It looks like the vehicle is outside the manufacturer warranty. "
                "You may want to contact an independent garage or service centre who can help further. "
                "Is there anything else I can help you with today?"
            )
            prompt = config.get("prompts", {}).get("warranty_expired_redirect", default_prompt)

            return _result(prompt, session, config)

        if outcome == "capture_details":
            # Continue collecting details for human follow‑up
            # FIX: Only ask the opening question if we haven't started capturing yet
            if not session.get("capturing_details"):
                session["capturing_details"] = True
                save_session(session_id, session)

                default_prompt = (
                    "Thanks for that. Although the vehicle is outside warranty, I can still take some details. "
                    "Could you describe the issue you're experiencing?"
                )
                prompt = config.get("prompts", {}).get("warranty_expired_capture", default_prompt)
                return _result(prompt, session, config)
            
            # If we ARE capturing details, fall through to Step 4 logic



    # Step 3b -- In Warranty -> Configurable Capture
    elif status == "in_warranty":
        # Node "4" is "In Warranty: Ask Issue"
        behavior = _get_node_behavior("4", "warranty", config)

        if behavior.get("question_mode") == "single_turn":
            # Ask for issue description ONCE, then handover
            if not session.get("warranty_issue_asked"):
                session["warranty_issue_asked"] = True
                save_session(session_id, session)
                
                default_prompt = "Thanks. It looks like the vehicle is within the warranty period. Could you describe the issue you're experiencing?"
                prompt = config.get("prompts", {}).get("warranty_valid_ask_issue", default_prompt)
                return _result(prompt, session, config)
            
            # Second time: User has provided the issue, capture it and handover
            if text and text.strip():
                session["warranty_issue_description"] = text.strip()
            
            print("DEBUG: In-warranty (single_turn) capture done. Triggering handoff.", flush=True)
            session["intent"] = "service"
            save_session(session_id, session)
            return _result("Let me get that booked in for you.", session, config)
        
        else:
            # Multi-turn mode: Ensure we ask the opening question if not done
            if not session.get("warranty_issue_asked"):
                session["warranty_issue_asked"] = True
                save_session(session_id, session)
                default_prompt = "Thanks. It looks like the vehicle is within the warranty period. Could you describe the issue you're experiencing?"
                prompt = config.get("prompts", {}).get("warranty_valid_ask_issue", default_prompt)
                return _result(prompt, session, config)
            
            # If already asked, fall through to Step 4 (LLM logic)



    # Step 4 — In warranty → capture issue (hybrid with LLM)
    # Append the new text to the history of the issue description
    if text and text.strip():
        current_history = session.get("issue_history", "")
        new_history = f"{current_history}\nUser: {text.strip()}".strip()
        session["issue_history"] = new_history
        save_session(session_id, session)

    # Track follow-up count for multi-turn limits
    follow_up_count = session.get("warranty_follow_up_count", 0)
    
    # Check behavior for Node "4"
    behavior = _get_node_behavior("4", "warranty", config)
    max_ups = behavior.get("max_follow_ups", -1)

    # Use LLM to interpret the issue and optionally ask a clarifying question.
    llm_response = _llm_interpret_issue(text, session, config)
    
    if not llm_response:
        # Fallback if LLM fails
        llm_response = "I've made a note of that. Is there anything else you'd like to add?"

    # Check for [COMPLETE] signal
    print(f"DEBUG: Warranty LLM Response: '{llm_response}' (Follow-up: {follow_up_count}/{max_ups})", flush=True)
    
    # SANITIZE: Always strip tokens from the spoken response
    clean_response = llm_response.replace("[COMPLETE]", "").replace("[Thinking]", "").strip()

    # If we reached max follow-ups, force COMPLETE locally
    is_complete = "[COMPLETE]" in llm_response
    if max_ups != -1 and follow_up_count >= max_ups:
        print(f"DEBUG: Max follow-ups ({max_ups}) reached. Forcing completion.", flush=True)
        is_complete = True
    else:
        # Increment if not complete
        if not is_complete:
            session["warranty_follow_up_count"] = follow_up_count + 1
            save_session(session_id, session)

    if is_complete:
        print("DEBUG: Completion triggered.", flush=True)
        completion_config = config.get("warranty_completion", {})
        
        if completion_config.get("mode") == "handoff":
            target = completion_config.get("target_intent", "service")
            session["intent"] = target
            save_session(session_id, session)
            
            return _result(
                completion_config.get("transition_message", "Handoff to service."),
                session,
                config
            )

    return _result(
        clean_response,
        session,
        config,
    )


def _get_node_behavior(node_id: str, workflow_key: str, config: dict) -> dict:
    """
    Resolves behavior settings for a specific node, falling back to workflow-level defaults.
    """
    # 1. Fallback: Get workflow-level behavior
    workflow_behavior = config.get("workflow_behavior", {}).get(workflow_key, {
        "question_mode": "multi_turn",
        "max_follow_ups": 3
    })

    # 2. Check for Per-Node override
    workflow = config.get("workflows", {}).get(workflow_key, {})
    nodes = workflow.get("nodes", [])
    
    node = next((n for n in nodes if str(n.get("id")) == str(node_id)), None)
    
    if node:
        node_data = node.get("data", {})
        if node_data.get("behavior_override"):
            print(f"DEBUG: Found behavior override for node {node_id} in {workflow_key}", flush=True)
            return {
                "question_mode": node_data.get("question_mode", workflow_behavior.get("question_mode")),
                "max_follow_ups": node_data.get("max_follow_ups", workflow_behavior.get("max_follow_ups"))
            }

    return workflow_behavior



def _evaluate_warranty_status(purchase_date_iso: str, warranty_months: int) -> str:
    try:
        purchase_dt = datetime.fromisoformat(purchase_date_iso)
    except Exception:
        return "unknown"

    now = datetime.now()
    age_months = (now.year - purchase_dt.year) * 12 + (now.month - purchase_dt.month)

    if age_months > warranty_months:
        return "out_of_warranty"

    return "in_warranty"


def _llm_interpret_issue(text: str, session: dict, config: dict) -> str:
    """
    Uses Azure OpenAI to interpret the customer's issue and,
    if needed, ask ONE clear follow‑up question.

    This does NOT change business rules — it only affects wording and clarity.
    """
    customer_name = session.get("customer_name") or "there"
    brand = config.get("brand_name", "the dealership")

    system_prompt = (
        "You are assisting in a vehicle warranty workflow for an automotive contact centre. "
        "The vehicle is within warranty. Your job is to:\n"
        "1) The conversation is ONGOING. Do NOT say 'Hi', 'Hello', or 'Thanks for reaching out' repeatedly.\n"
        "2) If the description is unclear or incomplete, ask ONE clear follow‑up question.\n"
        "3) Keep the tone professional, warm, and efficient.\n"
        "4) CRITICAL: If you know WHAT the issue is and WHEN it happens, you MUST output ONLY the token '[COMPLETE]'. Do not ask more questions.\n"
        "Do NOT make promises about outcomes or eligibility. "
        "Do NOT mention internal processes. "
        "Keep the response to 1–2 short sentences."
    )
    
    # Use the FULL history, not just current text
    history = session.get("issue_history", text)

    user_prompt = (
        f"Customer name: {customer_name}\n"
        f"Brand or dealer: {brand}\n"
        f"Conversation History (Issue Description):\n{history}\n"
    )

    response = chat_completion(
        [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ]
    )

    if not response:
        return None

    return response.strip()


def _result(prompt: str, session: dict, config: dict) -> dict:
    return {"prompt": prompt, "session": session, "config": config}

