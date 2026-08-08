# openai-proxy

`openai-proxy` is an optional, removable local Plugin. It will expose a
ChatGPT/Codex subscription through the OpenAI-compatible model configuration
already supported by this project.

Phase 1 provides the TypeScript/Bun Plugin boundary and loopback-only gateway.
Phase 2 adds isolated ChatGPT browser/device-code login and private atomic
session storage. Phase 3 forwards ordinary streaming Chat Completions requests
to the official Codex Responses endpoint and adapts Responses SSE back to the
existing model stream. It never reads or imports Codex's own auth file.

## Development commands

```powershell
$env:OPENAI_PROXY_LOCAL_TOKEN = '<at-least-32-random-characters>'
bun run plugins/openai-proxy/host/entry.ts serve
bun run plugins/openai-proxy/host/entry.ts doctor
bun run plugins/openai-proxy/host/entry.ts login
bun run plugins/openai-proxy/host/entry.ts login --device-code
bun run plugins/openai-proxy/host/entry.ts status
bun run plugins/openai-proxy/host/entry.ts logout
```

The local base URL is fixed to `http://127.0.0.1:48181/v1`. Configure the
subscription model as an ordinary OpenAI-compatible model; no Provider or
proxy-specific model type is required:

```json
{
  "model": "<slug returned by /v1/models>",
  "baseUrl": "http://127.0.0.1:48181/v1",
  "apiKeyEnv": "OPENAI_PROXY_LOCAL_TOKEN"
}
```

The gateway implements `GET /v1/models` and streaming
`POST /v1/chat/completions`. Unsupported Chat Completions fields are rejected
explicitly instead of being silently removed. Upstream authentication, errors,
timeouts, cancellation and interrupted streams fail closed; there is no model
or endpoint fallback.

The MCP entry remains intentionally inert and does not bind the gateway
port. Automatic single-instance startup is deferred until the daemon lease and
multi-client lifecycle are implemented, so installing this Plugin cannot cause
port conflicts between existing CLI sessions.

ChatGPT credentials are stored only at `~/.claude/openai-proxy/auth.json`.
Writes use an atomic replacement and a bounded cross-process lock. POSIX mode is
restricted to `0600`; Windows uses a current-user-only ACL. Tokens are never
printed by `status` or `doctor` and are not exposed to the parent CLI.

`GET /health` contains no credentials and is intentionally available without
authentication. `/doctor`, `/v1/models`, and `/v1/chat/completions` require
`Authorization: Bearer $OPENAI_PROXY_LOCAL_TOKEN`.
