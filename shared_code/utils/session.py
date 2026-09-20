import json
import os
import re
import tempfile
import threading
from pathlib import Path


SESSION_DIR = Path(os.getenv("SESSION_DIR", "sessions"))
SESSION_DIR.mkdir(parents=True, exist_ok=True)

_LOCKS: dict[str, threading.RLock] = {}
_LOCKS_GUARD = threading.Lock()


def _safe_session_id(session_id: str) -> str:
    safe = re.sub(r"[^A-Za-z0-9_.-]", "_", str(session_id or ""))
    if not safe or safe in {".", ".."}:
        raise ValueError("A valid session_id is required")
    return safe


def _session_path(session_id: str) -> Path:
    return SESSION_DIR / f"{_safe_session_id(session_id)}.json"


def _session_lock(session_id: str) -> threading.RLock:
    key = _safe_session_id(session_id)
    with _LOCKS_GUARD:
        return _LOCKS.setdefault(key, threading.RLock())


def load_session(session_id: str) -> dict:
    path = _session_path(session_id)
    with _session_lock(session_id):
        try:
            with path.open("r", encoding="utf-8") as handle:
                value = json.load(handle)
                return value if isinstance(value, dict) else {}
        except (FileNotFoundError, json.JSONDecodeError, OSError):
            return {}


def save_session(session_id: str, session: dict) -> None:
    path = _session_path(session_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary_path = None
    with _session_lock(session_id):
        try:
            with tempfile.NamedTemporaryFile(
                mode="w", encoding="utf-8", dir=path.parent,
                prefix=f".{path.stem}-", suffix=".tmp", delete=False,
            ) as handle:
                temporary_path = Path(handle.name)
                json.dump(session, handle, ensure_ascii=True)
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(temporary_path, path)
        except Exception as exc:
            if temporary_path:
                temporary_path.unlink(missing_ok=True)
            raise RuntimeError(f"Could not save session {session_id}") from exc

