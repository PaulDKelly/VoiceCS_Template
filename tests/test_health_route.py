import json
import pytest
from aiohttp import web
from aiohttp.test_utils import make_mocked_request

from bot_main import health_route


@pytest.mark.asyncio
async def test_health_route_requires_called_number():
    req = make_mocked_request("GET", "/health/route", app=web.Application())
    resp = await health_route(req)
    assert resp.status == 400
    body = json.loads(resp.text)
    assert body["error"] == "called_number is required"


@pytest.mark.asyncio
async def test_health_route_resolves_mapping(monkeypatch, tmp_path):
    data = {
        "mappings": {
            "+44 115-647-3116": {
                "client_id": "Thirsty Work",
                "industry": "sales",
            }
        }
    }
    mapping_path = tmp_path / "phone_mappings.json"
    mapping_path.write_text(json.dumps(data), encoding="utf-8")
    monkeypatch.setenv("APP_CONFIG_PATH", str(tmp_path))

    req = make_mocked_request("GET", "/health/route?called_number=+44%20115-647-3116", app=web.Application())
    resp = await health_route(req)
    assert resp.status == 200
    body = json.loads(resp.text)
    assert body["resolved_client_id"] == "Thirsty Work"
    assert body["resolved_industry"] == "sales"
