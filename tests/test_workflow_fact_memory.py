import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from shared_code.workflows.generic_engine import _process_node


class WorkflowFactMemoryTests(unittest.TestCase):
    def test_satisfied_capture_node_is_skipped(self):
        nodes = [
            {
                "id": "name",
                "type": "default",
                "data": {
                    "promptKey": "ask_name",
                    "captureVariable": "customer_name",
                },
            },
            {"id": "reason", "type": "default", "data": {"promptKey": "ask_reason"}},
        ]
        edges = [{"source": "name", "target": "reason"}]
        session = {"customer_name": "Paul", "intent": "first_response"}
        config = {"prompts": {"ask_name": "What is your name?", "ask_reason": "How can I help?"}}

        with tempfile.TemporaryDirectory() as directory:
            with patch("shared_code.utils.session.SESSION_DIR", Path(directory)):
                result = _process_node("name", nodes, edges, session, config, "fact-test")

        self.assertEqual(result["prompt"], "How can I help?")
        self.assertEqual(result["session"]["current_node_id"], "reason")

    def test_always_ask_can_force_confirmation(self):
        nodes = [{
            "id": "name",
            "type": "default",
            "data": {
                "promptKey": "ask_name",
                "captureVariable": "customer_name",
                "alwaysAsk": True,
            },
        }]
        session = {"customer_name": "Paul"}
        config = {"prompts": {"ask_name": "Please confirm your name."}}

        result = _process_node("name", nodes, [], session, config, "fact-test")

        self.assertEqual(result["prompt"], "Please confirm your name.")

    def test_failed_name_action_returns_to_name_question(self):
        nodes = [
            {"id": "ask", "type": "custom", "data": {"promptKey": "greeting"}},
            {"id": "extract", "type": "action", "data": {"actionType": "extract_name"}},
            {"id": "intent", "type": "custom", "data": {"promptKey": "ask_intent"}},
        ]
        edges = [
            {"source": "ask", "target": "extract"},
            {"source": "extract", "target": "intent"},
        ]
        session = {"_last_user_input": "Okay", "intent": "first_response"}
        config = {"prompts": {"ask_name_retry": "Please repeat your name."}}

        with tempfile.TemporaryDirectory() as directory:
            with patch("shared_code.utils.session.SESSION_DIR", Path(directory)):
                result = _process_node("extract", nodes, edges, session, config, "retry-test")

        self.assertEqual(result["prompt"], "Please repeat your name.")
        self.assertEqual(result["session"]["current_node_id"], "ask")
