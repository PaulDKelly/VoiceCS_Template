import enum
import time
from dataclasses import dataclass
from typing import Optional


class ConversationPhase(str, enum.Enum):
    STARTING = "starting"
    LISTENING = "listening"
    THINKING = "thinking"
    SPEAKING = "speaking"
    ENDING = "ending"
    CLOSED = "closed"


@dataclass(frozen=True)
class TurnToken:
    generation: int
    text: str
    started_at: float


class ConversationRuntime:
    """Owns turn state so callbacks cannot publish obsolete work or audio."""

    def __init__(self):
        self.phase = ConversationPhase.STARTING
        self.generation = 0
        self.interrupted_generation: Optional[int] = None

    def start_listening(self) -> None:
        if self.phase not in (ConversationPhase.ENDING, ConversationPhase.CLOSED):
            self.phase = ConversationPhase.LISTENING

    def begin_turn(self, text: str, now: Optional[float] = None) -> TurnToken:
        if self.phase in (ConversationPhase.ENDING, ConversationPhase.CLOSED):
            raise RuntimeError("conversation is ending")
        self.generation += 1
        self.interrupted_generation = None
        self.phase = ConversationPhase.THINKING
        return TurnToken(self.generation, text, time.monotonic() if now is None else now)

    def begin_speaking(self, token: TurnToken) -> bool:
        if not self.is_current(token):
            return False
        self.phase = ConversationPhase.SPEAKING
        return True

    def interrupt(self) -> Optional[int]:
        if self.phase != ConversationPhase.SPEAKING:
            return None
        self.interrupted_generation = self.generation
        self.phase = ConversationPhase.LISTENING
        return self.generation

    def finish_turn(self, token: TurnToken) -> bool:
        if not self.is_current(token):
            return False
        self.phase = ConversationPhase.LISTENING
        return True

    def is_current(self, token: TurnToken) -> bool:
        return (
            token.generation == self.generation
            and token.generation != self.interrupted_generation
            and self.phase not in (ConversationPhase.ENDING, ConversationPhase.CLOSED)
        )

    def may_accept_transcript(self, barge_in_confirmed: bool = False) -> bool:
        if self.phase == ConversationPhase.LISTENING:
            return True
        return self.phase == ConversationPhase.SPEAKING and barge_in_confirmed

    def begin_ending(self) -> None:
        self.generation += 1
        self.phase = ConversationPhase.ENDING

    def close(self) -> None:
        self.generation += 1
        self.phase = ConversationPhase.CLOSED

