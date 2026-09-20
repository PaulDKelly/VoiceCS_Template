# VoiceCS

VoiceCS is a configurable voice customer-service agent running on Azure Container Apps. Twilio provides bidirectional call audio, Azure Speech performs recognition, the workflow engine controls deterministic customer journeys, and ElevenLabs or Azure Speech synthesizes replies. The Next.js Workflow Manager edits client, prompt, routing, and workflow configuration.

## Applications

- Voice agent: `bot_main.py`, `shared_code/`, and `Dockerfile.python`
- Workflow Manager: `dashboard/`
- Runtime configuration: mounted at `APP_CONFIG_PATH` (normally `/app/config`)

## Local verification

```powershell
python -m compileall bot_main.py shared_code
python -m unittest discover -s tests
cd dashboard
npm ci
npm run build
```

Secrets and runtime user/session data are intentionally excluded from Git. Supply them through environment variables and Azure Container App secret references.

## Baseline

Branch `baseline/live-20260920` records the source deployed on 20 September 2026 before the conversation reliability redesign.
