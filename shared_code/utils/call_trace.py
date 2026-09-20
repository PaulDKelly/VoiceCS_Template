import json
import os
import time
from typing import Any, Dict, List

from shared_code.utils.config_loader import CONFIG_DIR

TRACE_FILE = os.path.join(CONFIG_DIR, "call_traces.jsonl")


def _ensure_parent_dir() -> None:
    parent = os.path.dirname(TRACE_FILE)
    if parent and not os.path.exists(parent):
        os.makedirs(parent, exist_ok=True)


def append_call_trace(entry: Dict[str, Any]) -> None:
    """Best-effort append-only call trace writer."""
    try:
        _ensure_parent_dir()
        payload = {
            "ts": time.time(),
            **(entry or {}),
        }
        with open(TRACE_FILE, "a", encoding="utf-8") as f:
            f.write(json.dumps(payload, ensure_ascii=False) + "\n")
    except Exception:
        # Tracing must never break live call handling.
        return


def read_recent_call_traces(limit: int = 100, industry: str = "", client_id: str = "") -> List[Dict[str, Any]]:
    try:
        if not os.path.exists(TRACE_FILE):
            return []
        out: List[Dict[str, Any]] = []
        with open(TRACE_FILE, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    item = json.loads(line)
                except Exception:
                    continue
                if industry and str(item.get("industry") or "").lower() != industry.lower():
                    continue
                if client_id and str(item.get("client_id") or "").lower() != client_id.lower():
                    continue
                out.append(item)
        out.sort(key=lambda x: float(x.get("ts") or 0), reverse=True)
        return out[: max(1, min(limit, 500))]
    except Exception:
        return []
