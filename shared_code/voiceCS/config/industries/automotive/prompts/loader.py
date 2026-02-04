import os

BASE_DIR = os.path.dirname(__file__)


def _load(path: str) -> str:
    with open(path, "r", encoding="utf-8") as f:
        return f.read().strip()


def build_prompt(industry: str, intent: str) -> str:
    base = os.path.join(BASE_DIR, "..")  # industry root

    parts = [
        _load(os.path.join(base, "prompts/system/base_system_prompt.txt")),
        _load(os.path.join(base, "prompts/system/brand_info_prompt.txt")),
        _load(os.path.join(base, "prompts/system/intent_routing_prompt.txt")),
    ]

    intent_prompt = os.path.join(base, f"prompts/{intent}/{intent}_prompt.txt")
    if os.path.exists(intent_prompt):
        parts.append(_load(intent_prompt))

    return "\n\n".join(parts)

