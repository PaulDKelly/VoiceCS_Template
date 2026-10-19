"""Dedicated Corempower/Kira web voice service."""

import logging
import os

from aiohttp import web

from shared_code.kira_web_api import register_kira_routes


logging.basicConfig(level=logging.INFO)


async def health(_request):
    return web.json_response({"status": "ok", "service": "kira-voice-orchestrator"})


app = web.Application(client_max_size=10 * 1024 * 1024)
app.router.add_get("/health", health)
register_kira_routes(app)


if __name__ == "__main__":
    web.run_app(app, host="0.0.0.0", port=int(os.getenv("PORT", "8000")))
