# openai-proxy

`openai-proxy` is an optional, removable local Plugin. It will expose a
ChatGPT/Codex subscription through the OpenAI-compatible model configuration
already supported by this project.

Phase 1 provides only the TypeScript/Bun Plugin boundary, standalone Host,
loopback-only authenticated gateway, diagnostics, and fail-closed placeholder
for model requests. It does not perform OAuth, read Codex credentials, or send
requests to OpenAI.

## Development commands

```powershell
$env:OPENAI_PROXY_LOCAL_TOKEN = '<at-least-32-random-characters>'
bun run plugins/openai-proxy/host/entry.ts serve
bun run plugins/openai-proxy/host/entry.ts doctor
```

The local base URL is fixed to `http://127.0.0.1:48181/v1`. Until a later phase
implements the audited Responses transport, `POST /v1/chat/completions` returns
a deterministic `503 openai_proxy_not_ready` error and never falls back to a
remote endpoint.

The phase 1 MCP entry is intentionally inert and does not bind the gateway
port. Automatic single-instance startup is deferred until the daemon lease and
multi-client lifecycle are implemented, so installing this Plugin cannot cause
port conflicts between existing CLI sessions.

`GET /health` contains no credentials and is intentionally available without
authentication. `/doctor`, `/v1/models`, and `/v1/chat/completions` require
`Authorization: Bearer $OPENAI_PROXY_LOCAL_TOKEN`.
