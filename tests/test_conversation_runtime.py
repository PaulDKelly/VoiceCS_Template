import unittest

from shared_code.voice.conversation_runtime import ConversationPhase, ConversationRuntime


class ConversationRuntimeTests(unittest.TestCase):
    def test_serial_turn_lifecycle(self):
        runtime = ConversationRuntime()
        runtime.start_listening()
        token = runtime.begin_turn("hello", now=1.0)
        self.assertEqual(runtime.phase, ConversationPhase.THINKING)
        self.assertTrue(runtime.begin_speaking(token))
        self.assertEqual(runtime.phase, ConversationPhase.SPEAKING)
        self.assertTrue(runtime.finish_turn(token))
        self.assertEqual(runtime.phase, ConversationPhase.LISTENING)

    def test_interrupted_turn_cannot_publish_more_audio(self):
        runtime = ConversationRuntime()
        runtime.start_listening()
        token = runtime.begin_turn("hello")
        runtime.begin_speaking(token)
        runtime.interrupt()
        self.assertFalse(runtime.is_current(token))
        self.assertFalse(runtime.begin_speaking(token))
        self.assertTrue(runtime.may_accept_transcript())

    def test_old_generation_is_stale(self):
        runtime = ConversationRuntime()
        runtime.start_listening()
        old = runtime.begin_turn("one")
        runtime.finish_turn(old)
        current = runtime.begin_turn("two")
        self.assertFalse(runtime.is_current(old))
        self.assertTrue(runtime.is_current(current))

    def test_speech_during_playback_requires_confirmed_barge_in(self):
        runtime = ConversationRuntime()
        runtime.start_listening()
        token = runtime.begin_turn("hello")
        runtime.begin_speaking(token)
        self.assertFalse(runtime.may_accept_transcript())
        self.assertTrue(runtime.may_accept_transcript(barge_in_confirmed=True))

    def test_closed_runtime_rejects_new_turns(self):
        runtime = ConversationRuntime()
        runtime.close()
        with self.assertRaises(RuntimeError):
            runtime.begin_turn("late")

    def test_ending_invalidates_the_current_turn(self):
        runtime = ConversationRuntime()
        runtime.start_listening()
        token = runtime.begin_turn("goodbye")
        runtime.begin_ending()
        self.assertFalse(runtime.is_current(token))
        self.assertEqual(runtime.phase, ConversationPhase.ENDING)
