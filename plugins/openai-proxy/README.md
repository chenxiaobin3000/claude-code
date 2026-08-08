# openai-proxy

`openai-proxy` is an optional, removable local Plugin. It will expose a
ChatGPT/Codex subscription through the OpenAI-compatible model configuration
already supported by this project.

Phase 1 provides only the TypeScript/Bun Plugin boundary, standalone Host,
loopback-only authenticated gateway, diagnostics, and fail-closed placeholder
for model requests. Phase 2 adds an isolated ChatGPT browser/device-code login,
token refresh/revocation, JWT account metadata parsing, and private atomic
session storage. It never reads or imports Codex's own auth file.

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

The local base URL is fixed to `http://127.0.0.1:48181/v1`. Until a later phase
implements the audited Responses transport, `POST /v1/chat/completions` returns
a deterministic `503 openai_proxy_not_ready` error and never falls back to a
remote endpoint.

The phase 1 MCP entry is intentionally inert and does not bind the gateway
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
