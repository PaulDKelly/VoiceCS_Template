import json
import os
from shared_code.voiceCS.utils.config_loader import load_merged_config

RULES_PATH = os.path.join(os.path.dirname(__file__), "intent_rules.json")

with open(RULES_PATH, "r", encoding="utf-8") as f:
    INTENT_KEYWORDS = json.load(f)


def detect_intent(text, client_id, industry):
    text_lower = text.lower()

    # Sales
    if any(word in text_lower for word in ["buy", "purchase", "new car", "test drive"]):
        return "sales"

    # Finance
    if any(word in text_lower for word in ["finance", "loan", "monthly payment"]):
        return "finance"

    # Service (includes warranty issues)
    if any(word in text_lower for word in ["problem", "issue", "repair", "service", "broken", "not working"]):
        return "service"

    # Default fallback
    return "general"




