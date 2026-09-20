import audioop
import struct
import unittest

from shared_code.voice.turn_detection import (
    AudioActivityDetector,
    DuplicateUtteranceGuard,
    build_typing_ulaw,
)


def pcm_frame(amplitude: int, duration_ms: int = 20) -> bytes:
    samples = int(8000 * duration_ms / 1000)
    return b"".join(struct.pack("<h", amplitude if i % 2 else -amplitude) for i in range(samples))


class AudioActivityDetectorTests(unittest.TestCase):
    def test_silence_does_not_trigger_barge_in(self):
        detector = AudioActivityDetector(rms_threshold=500, min_speech_ms=200)
        self.assertFalse(any(detector.observe(pcm_frame(0)) for _ in range(30)))

    def test_sustained_speech_triggers_once(self):
        detector = AudioActivityDetector(rms_threshold=500, min_speech_ms=200)
        results = [detector.observe(pcm_frame(1800)) for _ in range(20)]
        self.assertEqual(results.count(True), 1)

    def test_short_noise_burst_does_not_trigger(self):
        detector = AudioActivityDetector(rms_threshold=500, min_speech_ms=240, release_ms=100)
        for _ in range(5):
            detector.observe(pcm_frame(2200))
        for _ in range(6):
            detector.observe(pcm_frame(0))
        self.assertFalse(detector.observe(pcm_frame(2200)))


class DuplicateUtteranceGuardTests(unittest.TestCase):
    def test_normalized_duplicate_is_suppressed_inside_window(self):
        guard = DuplicateUtteranceGuard(window_seconds=2)
        self.assertFalse(guard.is_duplicate("My registration is AB12 CDE.", now=10))
        self.assertTrue(guard.is_duplicate("my registration is ab12 cde", now=11))
        self.assertFalse(guard.is_duplicate("my registration is ab12 cde", now=13.1))


class TypingAudioTests(unittest.TestCase):
    def test_typing_audio_is_mulaw_and_not_silent(self):
        audio = build_typing_ulaw(500)
        self.assertEqual(len(audio), 4000)
        decoded = audioop.ulaw2lin(audio, 2)
        self.assertGreater(audioop.rms(decoded, 2), 10)


if __name__ == "__main__":
    unittest.main()
