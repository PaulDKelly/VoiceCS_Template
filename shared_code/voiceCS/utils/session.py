# For local testing only; in production you'd use Redis, Cosmos, etc.

_sessions = {}

def load_session(session_id: str) -> dict:
    return _sessions.get(session_id, {})

def save_session(session_id: str, session: dict) -> None:
    _sessions[session_id] = session

