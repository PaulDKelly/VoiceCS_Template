import audioop
import math
import re
import struct
import time
from dataclasses import dataclass
from typing import Optional


def normalize_utterance(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", str(text or "").lower()).strip()


@dataclass
class DuplicateUtteranceGuard:
    window_seconds: float = 1.75
    _last_text: str = ""
    _last_at: float = 0.0

    def is_duplicate(self, text: str, now: Optional[float] = None) -> bool:
        normalized = normalize_utterance(text)
        if not normalized:
            return False
        current = time.monotonic() if now is None else now
        duplicate = normalized == self._last_text and current - self._last_at <= self.window_seconds
        self._last_text = normalized
        self._last_at = current
        return duplicate


class AudioActivityDetector:
    """Detect sustained caller speech in 8 kHz, 16-bit mono PCM frames."""

    def __init__(self, rms_threshold: int = 500, min_speech_ms: int = 240, release_ms: int = 180):
        self.rms_threshold = max(1, int(rms_threshold))
        self.min_speech_ms = max(20, int(min_speech_ms))
        self.release_ms = max(20, int(release_ms))
        self._speech_ms = 0.0
        self._silence_ms = 0.0
        self._triggered = False

    def reset(self) -> None:
        self._speech_ms = 0.0
        self._silence_ms = 0.0
        self._triggered = False

    def observe(self, pcm: bytes) -> bool:
        if not pcm:
            return False
        frame_ms = (len(pcm) / 2 / 8000) * 1000
        active = audioop.rms(pcm, 2) >= self.rms_threshold
        if active:
            self._speech_ms += frame_ms
            self._silence_ms = 0.0
        else:
            self._silence_ms += frame_ms
            if self._silence_ms >= self.release_ms:
                self._speech_ms = 0.0
                self._triggered = False
        if not self._triggered and self._speech_ms >= self.min_speech_ms:
            self._triggered = True
            return True
        return False


def build_typing_ulaw(duration_ms: int = 900, sample_rate: int = 8000) -> bytes:
    """Create a quiet deterministic typing texture as headerless mu-law audio."""
    sample_count = max(1, int(sample_rate * max(duration_ms, 100) / 1000))
    pcm = [0] * sample_count
    click_spacing = int(sample_rate * 0.115)
    click_length = int(sample_rate * 0.014)
    for click_index, start in enumerate(range(int(sample_rate * 0.08), sample_count, click_spacing)):
        base_frequency = 1450 + (click_index % 4) * 170
        for offset in range(min(click_length, sample_count - start)):
            decay = 1.0 - (offset / max(click_length, 1))
            sample = int(1250 * decay * math.sin(2 * math.pi * base_frequency * offset / sample_rate))
            pcm[start + offset] = max(-32768, min(32767, sample))
    pcm_bytes = b"".join(struct.pack("<h", sample) for sample in pcm)
    return audioop.lin2ulaw(pcm_bytes, 2)
