import unittest

from shared_code.agent.agent_engine import _extract_name_smartly
from shared_code.voice.name_resolution import resolve_recognition_candidates


class NameCaptureTests(unittest.TestCase):
    def test_accepts_short_first_name_without_llm(self):
        self.assertEqual(_extract_name_smartly("Paul."), "Paul")

    def test_extracts_common_spoken_prefix(self):
        self.assertEqual(_extract_name_smartly("My name is Paul Kelly"), "Paul Kelly")

    def test_rejects_acknowledgements_and_sentences(self):
        self.assertIsNone(_extract_name_smartly("Okay"))
        self.assertIsNone(_extract_name_smartly("I need help with an order"))

    def test_resolves_close_speech_guess_to_common_name(self):
        self.assertEqual(_extract_name_smartly("Pull"), "Paul")

    def test_retains_unfamiliar_but_valid_name(self):
        self.assertEqual(_extract_name_smartly("Zarek"), "Zarek")

    def test_combines_live_nbest_guesses_into_real_name(self):
        candidates = [
            {"text": "Pull.", "confidence": 0.08},
            {"text": "paul", "confidence": 0.045},
            {"text": "pole", "confidence": 0.041},
            {"text": "pohl", "confidence": 0.04},
        ]
        self.assertEqual(resolve_recognition_candidates(candidates), ("Paul", 0.08))
