import json
import os
from azure.storage.blob import BlobServiceClient

BASE_DIR = os.path.dirname(__file__)
WORKFLOW_BASE = os.path.join(BASE_DIR, "..", "config", "industries")

BLOB_CONNECTION = os.getenv("WORKFLOW_BLOB_CONNECTION")
BLOB_CONTAINER = os.getenv("WORKFLOW_BLOB_CONTAINER", "workflow-overrides")

_blob_client = None
_container_client = None


def _get_container():
    global _blob_client, _container_client

    if not BLOB_CONNECTION:
        return None

    if _container_client is None:
        _blob_client = BlobServiceClient.from_connection_string(BLOB_CONNECTION)
        _container_client = _blob_client.get_container_client(BLOB_CONTAINER)

    return _container_client


def load_workflow(intent: str, client_id: str, industry: str) -> dict:
    filename = f"{intent}.json"

    container = _get_container()
    if container:
        blob_path = f"{client_id}/{filename}"
        blob = container.get_blob_client(blob_path)
        if blob.exists():
            data = blob.download_blob().readall()
            return json.loads(data)

    local_path = os.path.join(WORKFLOW_BASE, industry, "workflows", filename)

    if not os.path.exists(local_path):
        fallback = os.path.join(WORKFLOW_BASE, industry, "workflows", "service.json")
        print(f"DEBUG: Workflow '{filename}' not found. Falling back to service.json")
        local_path = fallback

    print("DEBUG: loading workflow from:", local_path)

    with open(local_path, "r", encoding="utf-8") as f:
        return json.load(f)





