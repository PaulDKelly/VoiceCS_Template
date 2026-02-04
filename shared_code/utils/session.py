import json
import os
import shutil

SESSION_DIR = "sessions"
os.makedirs(SESSION_DIR, exist_ok=True)

def load_session(session_id: str) -> dict:
    path = os.path.join(SESSION_DIR, f"{session_id}.json")
    if os.path.exists(path):
        try:
            with open(path, "r") as f:
                return json.load(f)
        except Exception:
            return {}
    return {}

def save_session(session_id: str, session: dict) -> None:
    path = os.path.join(SESSION_DIR, f"{session_id}.json")
    try:
        with open(path, "w") as f:
            json.dump(session, f)
    except Exception as e:
        print(f"Error saving session {session_id}: {e}")

