import os

import pytest
import pytest_asyncio
from aiohttp.test_utils import TestClient, TestServer
from aiohttp import web

from shared_code.kira_web_api import register_kira_routes


@pytest_asyncio.fixture
async def client():
    os.environ["COREMPOWER_VOICE_API_KEY"] = "test-secret"
    app = web.Application()
    register_kira_routes(app)
    async with TestClient(TestServer(app)) as value:
        yield value


@pytest.mark.asyncio
async def test_kira_routes_require_authentication(client):
    response = await client.post("/api/kira/turn", json={"text": "hello"})
    assert response.status == 401


@pytest.mark.asyncio
async def test_continue_story_returns_privileged_action_for_corempower(client):
    response = await client.post(
        "/api/kira/turn",
        json={"session_id": "user-1", "text": "continue my story"},
        headers={"Authorization": "Bearer test-secret"},
    )
    assert response.status == 200
    payload = await response.json()
    assert payload["action"] == "continue_story"
    assert "check" in payload["reply"].lower()


@pytest.mark.asyncio
async def test_transcription_requires_wav(client):
    response = await client.post(
        "/api/kira/transcribe",
        data=b"not wav",
        headers={"Authorization": "Bearer test-secret", "Content-Type": "audio/webm"},
    )
    assert response.status == 415
