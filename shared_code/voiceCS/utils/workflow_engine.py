import json
import os
import logging

from shared_code.voiceCS.utils.workflow_loader import load_workflow

SESSION_DIR = "sessions"
os.makedirs(SESSION_DIR, exist_ok=True)


def session_path(session_id):
    return os.path.join(SESSION_DIR, f"{session_id}.json")


def load_session(session_id):
    path = session_path(session_id)
    if os.path.exists(path):
        with open(path, "r") as f:
            try:
                return json.load(f)
            except Exception:
                logging.exception(f"Failed to load session JSON for {session_id}")
                return {}
    return {}


def save_session(session_id, data):
    try:
        with open(session_path(session_id), "w") as f:
            json.dump(data, f)
    except Exception:
        logging.exception(f"Failed to save session JSON for {session_id}")


# =========================================================
# WORKFLOW ENGINE
# =========================================================

def next_state_from_workflow(workflow: dict, current_state: str) -> str:
    """
    Reads the workflow JSON and determines the next state.
    """
    state_def = workflow.get("states", {}).get(current_state)

    if not state_def:
        return workflow.get("default_start_state", "start")

    return state_def.get("next", "start")


def prompt_from_workflow(workflow: dict, state: str) -> str:
    """
    Reads the workflow JSON and returns the prompt for the given state.
    """
    state_def = workflow.get("states", {}).get(state)

    if not state_def:
        return workflow.get("fallback_prompt", "How can I help you today?")

    return state_def.get("prompt", "How can I help you today?")


def run_workflow_step(session_id: str, user_text: str) -> str:
    logging.warning(f"[WORKFLOW_ENGINE] run_workflow_step session_id={session_id} user_text={user_text!r}")

    session = load_session(session_id)

    # Defaults
    session.setdefault("client_id", "autonova")
    session.setdefault("industry", "automotive")
    session.setdefault("intent", "service")
    session.setdefault("state", "start")

    client_id = session["client_id"]
    industry = session["industry"]
    intent = session["intent"]
    current_state = session["state"]

    # Load workflow JSON
    workflow = load_workflow(intent, client_id, industry)

    # Determine next state
    new_state = next_state_from_workflow(workflow, current_state)
    session["state"] = new_state
    save_session(session_id, session)

    # Build prompt
    prompt = prompt_from_workflow(workflow, new_state)

    logging.warning(f"[WORKFLOW_ENGINE] state={new_state} prompt={prompt!r}")
    return prompt



