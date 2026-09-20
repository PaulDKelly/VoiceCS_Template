import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from shared_code.utils import session as session_store


class SessionStoreTests(unittest.TestCase):
    def test_round_trip_uses_safe_path_and_atomic_write(self):
        with tempfile.TemporaryDirectory() as directory:
            with patch.object(session_store, "SESSION_DIR", Path(directory)):
                session_store.save_session("call/../123", {"turn": 2})
                self.assertEqual(session_store.load_session("call/../123"), {"turn": 2})
                self.assertEqual(len(list(Path(directory).glob("*.json"))), 1)
                self.assertEqual(list(Path(directory).glob("*.tmp")), [])

    def test_invalid_json_returns_empty_session(self):
        with tempfile.TemporaryDirectory() as directory:
            with patch.object(session_store, "SESSION_DIR", Path(directory)):
                session_store._session_path("broken").write_text("{not-json", encoding="utf-8")
                self.assertEqual(session_store.load_session("broken"), {})

    def test_saved_file_is_valid_json(self):
        with tempfile.TemporaryDirectory() as directory:
            with patch.object(session_store, "SESSION_DIR", Path(directory)):
                session_store.save_session("abc", {"name": "Paul"})
                value = json.loads((Path(directory) / "abc.json").read_text(encoding="utf-8"))
                self.assertEqual(value["name"], "Paul")


if __name__ == "__main__":
    unittest.main()
