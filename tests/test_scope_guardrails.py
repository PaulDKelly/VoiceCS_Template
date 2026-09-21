import unittest

from shared_code.workflows.generic_engine import _first_response_intent_prompt


class ScopeGuardrailTests(unittest.TestCase):
    def test_fallback_does_not_advertise_unregistered_intents(self):
        config = {"intents": ["first_response", "sales"], "prompts": {}}
        prompt = _first_response_intent_prompt(config)
        self.assertIn("can't help", prompt)
        self.assertNotIn("warranty", prompt.lower())
        self.assertNotIn("finance", prompt.lower())

    def test_client_can_override_scope_refusal(self):
        config = {
            "intents": ["first_response", "sales"],
            "prompts": {"scope_refusal": "That is outside our order service."},
        }
        self.assertEqual(
            _first_response_intent_prompt(config),
            "That is outside our order service.",
        )

