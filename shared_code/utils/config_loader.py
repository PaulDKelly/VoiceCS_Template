import json
import os
try:
    from azure.storage.blob import BlobServiceClient
except Exception:
    BlobServiceClient = None

BASE_DIR = os.path.dirname(__file__)
# Allow overriding the config source location (e.g. for mounted volumes)
CONFIG_DIR = os.getenv("APP_CONFIG_PATH", os.path.join(BASE_DIR, "..", "config"))

BLOB_CONNECTION = os.getenv("CONFIG_BLOB_CONNECTION")
BLOB_CONTAINER = os.getenv("CONFIG_BLOB_CONTAINER", "client-configs")

_blob_client = None
_container_client = None


def _get_container():
    global _blob_client, _container_client
    if not BLOB_CONNECTION:
        return None
    if BlobServiceClient is None:
        return None
    if _container_client is None:
        _blob_client = BlobServiceClient.from_connection_string(BLOB_CONNECTION)
        _container_client = _blob_client.get_container_client(BLOB_CONTAINER)
    return _container_client


def load_json(path):
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def load_industry_defaults(industry):
    path = os.path.join(CONFIG_DIR, "industries", industry, "defaults.json")
    return load_json(path)


def load_client_config(industry, client_id):
    # 1. Try exact match
    path = os.path.join(CONFIG_DIR, "clients", industry, f"{client_id}.json")
    if os.path.exists(path):
        return load_json(path)

    # 2. Try lowercase
    lower_path = os.path.join(CONFIG_DIR, "clients", industry, f"{client_id.lower()}.json")
    if os.path.exists(lower_path):
        return load_json(lower_path)

    # 3. Scan directory for case-insensitive match
    client_dir = os.path.join(CONFIG_DIR, "clients", industry)
    if os.path.exists(client_dir):
        for filename in os.listdir(client_dir):
            if filename.lower() == f"{client_id.lower()}.json":
                return load_json(os.path.join(client_dir, filename))

    # 4. Fallback: Return empty dict or default structure to prevent crash
    print(f"WARNING: Client config not found for {industry}/{client_id}")
    return {"client_id": client_id, "industry": industry}






def load_blob_override(client_id):
    container = _get_container()
    if not container:
        return None

    blob = container.get_blob_client(f"{client_id}.json")
    if blob.exists():
        data = blob.download_blob().readall()
        return json.loads(data)

    return None


def merge_dicts(base, override):
    result = base.copy()
    for key, value in override.items():
        if isinstance(value, dict) and key in result:
            result[key] = merge_dicts(result[key], value)
        else:
            result[key] = value
    return result


def load_merged_config(client_id, industry):
    industry_defaults = load_industry_defaults(industry)
    client_config = load_client_config(industry, client_id)
    blob_override = load_blob_override(client_id)

    merged = merge_dicts(industry_defaults, client_config)

    if blob_override:
        merged = merge_dicts(merged, blob_override)

    return merged




def load_phone_mappings():
    path = os.path.join(CONFIG_DIR, "phone_mappings.json")
    if os.path.exists(path):
        data = load_json(path)
        mappings = data.get("mappings", {})
        # Normalize mapping keys to improve matching (strip spaces, dashes, parentheses)
        try:
            import re
            normalized = {}
            for key, value in mappings.items():
                if not isinstance(key, str):
                    normalized[key] = value
                    continue
                cleaned = re.sub(r"[\s\-()]", "", key)
                normalized[cleaned] = value
                # Also include exact key if different
                if cleaned != key:
                    normalized[key] = value
            return normalized
        except Exception:
            return mappings
    return {}
