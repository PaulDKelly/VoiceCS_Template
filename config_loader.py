import json
import os

# Determine the project root (folder containing this file)
PROJECT_ROOT = os.path.dirname(os.path.abspath(__file__))

# All config assets live under /config
CONFIG_ROOT = os.path.join(PROJECT_ROOT, "config")


def load_text(relative_path: str) -> str:
    """
    Load a UTF-8 text file relative to the config folder.
    Example: load_text("prompts/warranty_prompt.txt")
    """
    full_path = os.path.join(CONFIG_ROOT, relative_path)
    with open(full_path, "r", encoding="utf-8") as f:
        return f.read()


def load_json(relative_path: str) -> dict:
    """
    Load a JSON file relative to the config folder.
    Example: load_json("clients/fortell.json")
    """
    full_path = os.path.join(CONFIG_ROOT, relative_path)
    with open(full_path, "r", encoding="utf-8") as f:
        return json.load(f)


def build_final_prompt(client_name: str) -> str:
    """
    Build the base system prompt:
    - base_system_prompt
    - intent_routing_prompt
    - brand_info_prompt
    """
    client_config = load_json(f"clients/{client_name}.json")

    base_prompt = load_text("prompts/base_system_prompt.txt")
    routing_prompt = load_text("prompts/intent_routing_prompt.txt")
    brand_info_prompt = load_text("prompts/brand_info_prompt.txt")

    final_prompt = "\n\n".join([base_prompt, routing_prompt, brand_info_prompt])

    # Inject {{placeholders}}
    for key, value in client_config.items():
        final_prompt = final_prompt.replace(f"{{{{{key}}}}}", str(value))

    return final_prompt


def load_workflow_prompt(name: str, client_name: str) -> str:
    """
    Load a workflow prompt (warranty/sales/service/finance) and inject client config.
    """
    client_config = load_json(f"clients/{client_name}.json")
    text = load_text(f"prompts/{name}_prompt.txt")

    for key, value in client_config.items():
        text = text.replace(f"{{{{{key}}}}}", str(value))

    return text


def get_voice_name(client_name: str) -> str | None:
    """
    Returns the configured Azure neural voice name for the given client.
    """
    client_config = load_json(f"clients/{client_name}.json")
    return client_config.get("voice_name")
