from typing import Dict, List

from shared_code.llm.aoai_client import chat_completion
from shared_code.utils.config_loader import load_merged_config


def detect_intent(text: str, client_id: str, industry: str) -> str:
    """
    Dynamic, config-driven intent detection.

    - Uses keyword rules per intent from client config.
    - Applies priority ordering from config.
    - Respects per-intent enable flags.
    - Optionally falls back to LLM using the configured intent list.
    """
    config = load_merged_config(client_id, industry)

    intents: List[str] = config.get("intents", ["general"])
    rules: Dict = config.get("intent_routing_rules", {})
    text_lower = text.lower()

    priority_order: List[str] = rules.get("priority", intents)
    fallback_to_llm: bool = rules.get("fallback_to_llm", True)

    # 1. Keyword-based routing
    keyword_hits: Dict[str, bool] = {}

    for intent in intents:
        intent_rule = rules.get(intent, {})
        keywords = intent_rule.get("keywords", [])
        enabled = intent_rule.get("enabled", True)

        # Also respect top-level enable flags like enable_warranty, enable_service, etc.
        enable_flag = f"enable_{intent}"
        if enable_flag in config and not config.get(enable_flag, True):
            enabled = False

        if not enabled:
            continue

        if any(kw in text_lower for kw in keywords):
            keyword_hits[intent] = True

    # 2. Apply priority ordering
    for intent in priority_order:
        if keyword_hits.get(intent):
            return intent

    # 3. Fallback to LLM if enabled
    if fallback_to_llm:
        return llm_detect_intent(text, intents, config)

    # 4. Default to general if nothing matches
    return "general"


def llm_detect_intent(text: str, intents: List[str], config: Dict) -> str:
    """
    LLM-based intent classification constrained to the configured intent list.
    """
    intents_str = ", ".join(intents)

    system_prompt = (
        "You are an intent classification engine for a contact centre. "
        f"Return exactly one of the following intents: {intents_str}. "
        "Return only the intent name, nothing else."
    )

    user_prompt = f"Classify the intent of this message: '{text}'"

    intent = chat_completion([
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_prompt}
    ])

    intent = intent.strip().lower()

    # If the LLM returns something unexpected, or the intent is disabled, fall back to general.
    if intent not in intents:
        return "general"

    enable_flag = f"enable_{intent}"
    if enable_flag in config and not config.get(enable_flag, True):
        return "general"

    intent_rule = config.get("intent_routing_rules", {}).get(intent, {})
    if not intent_rule.get("enabled", True):
        return "general"

    return intent



    





